//! On-demand Windows OCR. Pixels remain in memory and only recognized text reaches the UI.

use serde::Serialize;
use tauri::{AppHandle, Manager};
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
    GetDIBits, GetObjectW, ReleaseDC, SelectObject, StretchBlt, BITMAP, BITMAPINFO,
    BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ, SRCCOPY,
};
use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
use windows::Win32::System::Ole::CF_BITMAP;
use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, GetWindowTextW};

pub const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
pub const MIN_SIDE: i32 = 2;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VisionResult {
    pub window_title: String,
    pub text: String,
    pub width: i32,
    pub height: i32,
}

pub fn calculate_scaled_dimensions(src_w: i32, src_h: i32, max_dim: i32) -> Result<(i32, i32, usize), String> {
    if src_w < MIN_SIDE || src_h < MIN_SIDE {
        return Err("The selected area has no visible dimensions".into());
    }
    let safe_max = max_dim.max(MIN_SIDE);
    let scale = (safe_max as f64 / src_w.max(src_h) as f64).min(1.0);
    let width = (src_w as f64 * scale).round().max(1.0) as i32;
    let height = (src_h as f64 * scale).round().max(1.0) as i32;
    let byte_len = (width as usize).checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or("Area is too large to read")?;
    if byte_len > MAX_IMAGE_BYTES {
        return Err("Area is too large to read".into());
    }
    Ok((width, height, byte_len))
}

pub fn recognize(pixels: Vec<u8>, width: i32, height: i32, window_title: String) -> Result<VisionResult, String> {
    let writer = DataWriter::new().map_err(|e| e.to_string())?;
    writer.WriteBytes(&pixels).map_err(|e| e.to_string())?;
    let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width, height)
        .map_err(|e| e.to_string())?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("Windows OCR is unavailable: {e}"))?;
    let recognized = engine.RecognizeAsync(&bitmap).map_err(|e| e.to_string())?
        .get().map_err(|e| e.to_string())?;
    let text = recognized.Text().map_err(|e| e.to_string())?.to_string();
    Ok(VisionResult { window_title, text, width, height })
}

pub fn read_window(app: AppHandle) -> Result<VisionResult, String> {
    let window = app.get_webview_window("island").ok_or("island is unavailable")?;
    let target = crate::island::foreground_target(&window)
        .ok_or("Open another app before reading its window")?;

    let mut rect = RECT::default();
    unsafe { GetWindowRect(target, &mut rect) }.map_err(|e| e.to_string())?;
    let src_w = rect.right - rect.left;
    let src_h = rect.bottom - rect.top;
    let max = OcrEngine::MaxImageDimension().map_err(|e| e.to_string())? as i32;
    let (width, height, byte_len) = calculate_scaled_dimensions(src_w, src_h, max)?;

    let mut pixels = vec![0u8; byte_len];
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() { return Err("Could not capture the screen".into()); }
        let memory = CreateCompatibleDC(Some(screen));
        if memory.is_invalid() {
            ReleaseDC(None, screen);
            return Err("Could not allocate a screen capture".into());
        }
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        if bitmap.is_invalid() {
            let _ = DeleteDC(memory);
            ReleaseDC(None, screen);
            return Err("Could not allocate a screen bitmap".into());
        }
        let old = SelectObject(memory, HGDIOBJ(bitmap.0));
        let copied = if width == src_w && height == src_h {
            BitBlt(memory, 0, 0, width, height, Some(screen), rect.left, rect.top, SRCCOPY).is_ok()
        } else {
            StretchBlt(memory, 0, 0, width, height, Some(screen), rect.left, rect.top, src_w, src_h, SRCCOPY).as_bool()
        };
        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
        info.bmiHeader.biWidth = width;
        info.bmiHeader.biHeight = -height; // top-down BGRA
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB.0;
        SelectObject(memory, old);
        let lines = if copied {
            GetDIBits(screen, bitmap, 0, height as u32, Some(pixels.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS)
        } else { 0 };
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        if lines != height { return Err("The window could not be captured".into()); }
    }

    let mut title_buf = [0u16; 260];
    let count = unsafe { GetWindowTextW(target, &mut title_buf) };
    let window_title = String::from_utf16_lossy(&title_buf[..count.max(0) as usize]);
    recognize(pixels, width, height, window_title)
}

pub fn read_selection() -> Result<VisionResult, String> {
    unsafe {
        OpenClipboard(None).map_err(|_| "Clipboard is busy; try again".to_string())?;
        let captured = (|| -> Result<(Vec<u8>, i32, i32), String> {
            let handle = GetClipboardData(CF_BITMAP.0 as u32)
                .map_err(|_| "Select an area with Windows Snipping Tool first".to_string())?;
            let bitmap = HBITMAP(handle.0);
            let mut details = BITMAP::default();
            let size = std::mem::size_of::<BITMAP>() as i32;
            if GetObjectW(HGDIOBJ(bitmap.0), size, Some((&mut details as *mut BITMAP).cast())) != size {
                return Err("Could not read the selected image".into());
            }
            let width = details.bmWidth;
            let height = details.bmHeight;
            let max = OcrEngine::MaxImageDimension().map_err(|e| e.to_string())? as i32;
            let (scaled_w, scaled_h, len) = calculate_scaled_dimensions(width, height, max)?;
            let mut pixels = vec![0u8; len];
            let mut info = BITMAPINFO::default();
            info.bmiHeader.biSize = std::mem::size_of_val(&info.bmiHeader) as u32;
            info.bmiHeader.biWidth = scaled_w;
            info.bmiHeader.biHeight = -scaled_h;
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB.0;
            let dc = GetDC(None);
            if dc.is_invalid() { return Err("Could not read the selected image".into()); }
            let lines = GetDIBits(dc, bitmap, 0, scaled_h as u32, Some(pixels.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
            if lines != scaled_h { return Err("Could not read the selected image".into()); }
            Ok((pixels, scaled_w, scaled_h))
        })();
        let _ = CloseClipboard();
        let (pixels, width, height) = captured?;
        recognize(pixels, width, height, "Selected area".into())
    }
}

#[tauri::command]
pub async fn vision_read(app: AppHandle) -> Result<VisionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|e| e.to_string())?;
        let result = read_window(app);
        unsafe { RoUninitialize() };
        result
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn vision_read_selection() -> Result<VisionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|e| e.to_string())?;
        let result = read_selection();
        unsafe { RoUninitialize() };
        result
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_scaled_dimensions_within_bounds() {
        let (w, h, bytes) = calculate_scaled_dimensions(800, 600, 2600).expect("should succeed");
        assert_eq!(w, 800);
        assert_eq!(h, 600);
        assert_eq!(bytes, 800 * 600 * 4);
    }

    #[test]
    fn test_calculate_scaled_dimensions_downscaling() {
        let (w, h, bytes) = calculate_scaled_dimensions(4000, 2000, 2000).expect("should downscale");
        assert_eq!(w, 2000);
        assert_eq!(h, 1000);
        assert_eq!(bytes, 2000 * 1000 * 4);
    }

    #[test]
    fn test_calculate_scaled_dimensions_rejects_sub_min() {
        assert!(calculate_scaled_dimensions(1, 100, 2000).is_err());
        assert!(calculate_scaled_dimensions(100, 1, 2000).is_err());
        assert!(calculate_scaled_dimensions(0, 0, 2000).is_err());
        assert!(calculate_scaled_dimensions(-10, 50, 2000).is_err());
    }

    #[test]
    fn test_calculate_scaled_dimensions_rejects_oversized_allocation() {
        // 10000 x 10000 with max_dim 10000 would be 10000 * 10000 * 4 = 400 MB > MAX_IMAGE_BYTES (64 MB)
        let err = calculate_scaled_dimensions(10000, 10000, 10000).unwrap_err();
        assert!(err.contains("too large"));
    }
}
