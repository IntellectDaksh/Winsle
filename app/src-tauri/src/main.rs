// Winsle runs without a console window: Mochi is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    winsle_lib::run()
}
