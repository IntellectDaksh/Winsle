// CPU / RAM / NVIDIA GPU every 2 s. NVML is loaded at runtime so machines
// without an NVIDIA driver just get null GPU fields.

use std::ffi::c_void;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use windows::core::{s, w, PCWSTR};
use windows::Win32::Foundation::FILETIME;
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::Threading::GetSystemTimes;

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SysInfo {
    pub cpu: f64,
    pub ram_used_gb: f64,
    pub ram_total_gb: f64,
    pub ram_pct: f64,
    pub gpu: Option<f64>,
    pub gpu_temp: Option<f64>,
    pub vram_pct: Option<f64>,
    pub disk_free_gb: f64,
    pub disk_total_gb: f64,
    pub uptime_s: u64,
    pub net_down: Option<f64>,
    pub net_up: Option<f64>,
}

pub fn spawn(app: AppHandle) {
    let _ = std::thread::Builder::new().name("live-sys".into()).spawn(move || {
        let nvml = Nvml::load();
        let mut prev = cpu_times();
        let mut net_prev = net_bytes().map(|b| (b, Instant::now()));
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let now = cpu_times();
            let net_now = net_bytes().map(|b| (b, Instant::now()));
            if crate::live::paused() {
                prev = now;
                net_prev = net_now;
                continue;
            }
            let mut info = snapshot(prev, now, nvml.as_ref());
            if let (Some((a, ta)), Some((b, tb))) = (net_prev, net_now) {
                let secs = tb.duration_since(ta).as_secs_f64();
                (info.net_down, info.net_up) = net_rate(a, b, secs);
            }
            prev = now;
            net_prev = net_now;
            crate::live::emit(&app, "live-sys", info);
        }
    });
}

fn snapshot(prev: Option<CpuTimes>, now: Option<CpuTimes>, nvml: Option<&Nvml>) -> SysInfo {
    let cpu = match (prev, now) {
        (Some(a), Some(b)) => cpu_pct(a, b),
        _ => 0.0,
    };
    let (ram_used_gb, ram_total_gb, ram_pct) = ram();
    let (gpu, gpu_temp, vram_pct) = nvml.map(|n| n.read()).unwrap_or((None, None, None));
    let (disk_free_gb, disk_total_gb) = disk();
    let uptime_s = unsafe { GetTickCount64() } / 1000;
    SysInfo {
        cpu, ram_used_gb, ram_total_gb, ram_pct, gpu, gpu_temp, vram_pct,
        disk_free_gb, disk_total_gb, uptime_s, net_down: None, net_up: None,
    }
}

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

fn disk() -> (f64, f64) {
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let root: Vec<u16> = format!("{drive}\\").encode_utf16().chain(Some(0)).collect();
    let (mut free, mut total) = (0u64, 0u64);
    if unsafe { GetDiskFreeSpaceExW(PCWSTR(root.as_ptr()), Some(&mut free), Some(&mut total), None) }.is_err() {
        return (0.0, 0.0);
    }
    (round1(free as f64 / GB), round1(total as f64 / GB))
}

/// (in, out) octets summed over physical interfaces that are up.
fn net_bytes() -> Option<(u64, u64)> {
    unsafe {
        let mut t: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut t).is_err() || t.is_null() {
            return None;
        }
        let rows = std::slice::from_raw_parts((*t).Table.as_ptr(), (*t).NumEntries as usize);
        let sum = rows
            .iter()
            .filter(|r| r.InterfaceAndOperStatusFlags._bitfield & 1 != 0 && r.OperStatus == IfOperStatusUp)
            .fold((0u64, 0u64), |(i, o), r| (i + r.InOctets, o + r.OutOctets));
        FreeMibTable(t as *const _);
        Some(sum)
    }
}

/// Bytes/s between two samples; None if counters went backwards (adapter reset).
fn net_rate(a: (u64, u64), b: (u64, u64), secs: f64) -> (Option<f64>, Option<f64>) {
    if secs <= 0.0 || b.0 < a.0 || b.1 < a.1 {
        return (None, None);
    }
    (Some(((b.0 - a.0) as f64 / secs).round()), Some(((b.1 - a.1) as f64 / secs).round()))
}

#[derive(Clone, Copy)]
struct CpuTimes {
    idle: u64,
    kernel: u64, // includes idle
    user: u64,
}

fn ft(f: FILETIME) -> u64 {
    (f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64
}

fn cpu_times() -> Option<CpuTimes> {
    let (mut i, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe { GetSystemTimes(Some(&mut i), Some(&mut k), Some(&mut u)) }.ok()?;
    Some(CpuTimes { idle: ft(i), kernel: ft(k), user: ft(u) })
}

fn cpu_pct(a: CpuTimes, b: CpuTimes) -> f64 {
    let idle = b.idle.saturating_sub(a.idle);
    let total = b.kernel.saturating_sub(a.kernel) + b.user.saturating_sub(a.user);
    if total == 0 {
        return 0.0;
    }
    round1((1.0 - idle as f64 / total as f64) * 100.0).clamp(0.0, 100.0)
}

fn ram() -> (f64, f64, f64) {
    let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    if unsafe { GlobalMemoryStatusEx(&mut m) }.is_err() || m.ullTotalPhys == 0 {
        return (0.0, 0.0, 0.0);
    }
    let used = m.ullTotalPhys - m.ullAvailPhys;
    (
        round1(used as f64 / GB),
        round1(m.ullTotalPhys as f64 / GB),
        round1(used as f64 * 100.0 / m.ullTotalPhys as f64),
    )
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

#[repr(C)]
#[derive(Default)]
struct NvUtil {
    gpu: u32,
    memory: u32,
}
#[repr(C)]
#[derive(Default)]
struct NvMem {
    total: u64,
    free: u64,
    used: u64,
}

type NvHandle = *mut c_void;
type FnInit = unsafe extern "C" fn() -> i32;
type FnHandle = unsafe extern "C" fn(u32, *mut NvHandle) -> i32;
type FnUtil = unsafe extern "C" fn(NvHandle, *mut NvUtil) -> i32;
type FnTemp = unsafe extern "C" fn(NvHandle, u32, *mut u32) -> i32;
type FnMem = unsafe extern "C" fn(NvHandle, *mut NvMem) -> i32;

struct Nvml {
    dev: NvHandle,
    util: FnUtil,
    temp: FnTemp,
    mem: FnMem,
}

// Note: library is never unloaded/nvmlShutdown — it lives for the process.
impl Nvml {
    fn load() -> Option<Nvml> {
        unsafe {
            let lib = [w!("nvml.dll"), w!("C:\\Windows\\System32\\nvml.dll")]
                .into_iter()
                .find_map(|p: PCWSTR| LoadLibraryW(p).ok())?;
            let init: FnInit = std::mem::transmute(GetProcAddress(lib, s!("nvmlInit_v2"))?);
            let handle: FnHandle = std::mem::transmute(GetProcAddress(lib, s!("nvmlDeviceGetHandleByIndex_v2"))?);
            let util: FnUtil = std::mem::transmute(GetProcAddress(lib, s!("nvmlDeviceGetUtilizationRates"))?);
            let temp: FnTemp = std::mem::transmute(GetProcAddress(lib, s!("nvmlDeviceGetTemperature"))?);
            let mem: FnMem = std::mem::transmute(GetProcAddress(lib, s!("nvmlDeviceGetMemoryInfo"))?);
            if init() != 0 {
                return None;
            }
            let mut dev: NvHandle = std::ptr::null_mut();
            if handle(0, &mut dev) != 0 {
                return None;
            }
            Some(Nvml { dev, util, temp, mem })
        }
    }

    fn read(&self) -> (Option<f64>, Option<f64>, Option<f64>) {
        unsafe {
            let mut u = NvUtil::default();
            let gpu = ((self.util)(self.dev, &mut u) == 0).then_some(u.gpu as f64);
            let mut t = 0u32;
            let temp = ((self.temp)(self.dev, 0 /* NVML_TEMPERATURE_GPU */, &mut t) == 0).then_some(t as f64);
            let mut m = NvMem::default();
            let vram = ((self.mem)(self.dev, &mut m) == 0 && m.total > 0)
                .then(|| round1(m.used as f64 * 100.0 / m.total as f64));
            (gpu, temp, vram)
        }
    }
}

// NVML handles are thread-safe per NVIDIA docs; the struct only moves into the poller thread.
unsafe impl Send for Nvml {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_math() {
        let a = CpuTimes { idle: 100, kernel: 200, user: 100 };
        let b = CpuTimes { idle: 175, kernel: 300, user: 200 }; // 200 total, 75 idle
        assert_eq!(cpu_pct(a, b), 62.5);
        assert_eq!(cpu_pct(a, a), 0.0);
        assert_eq!(net_rate((0, 0), (2000, 500), 2.0), (Some(1000.0), Some(250.0)));
        assert_eq!(net_rate((10, 0), (5, 0), 2.0), (None, None));
    }

    #[test]
    #[ignore]
    fn print_live() {
        let nv = Nvml::load();
        let a = cpu_times();
        std::thread::sleep(Duration::from_secs(1));
        println!("SYS: nvml={} {:?}", nv.is_some(), snapshot(a, cpu_times(), nv.as_ref()));
    }
}
