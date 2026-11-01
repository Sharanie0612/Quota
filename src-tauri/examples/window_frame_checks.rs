use quota_lib::window_frame::tiled;

fn main() {
    let area = (0, 0, 3840, 2080);
    assert!(!tiled((240, 100, 1280, 800), area, 1.0));
    assert!(!tiled((0, 200, 1280, 800), area, 1.0));
    for rect in [(0,0,1920,2080),(1920,0,1920,2080),(0,0,1920,1040),(1920,1040,1920,1040),(1280,0,1280,2080),(0,0,3840,1040)] {
        assert!(tiled(rect, area, 1.0), "tile {rect:?}");
    }
    assert!(tiled((-1920,0,960,1040),(-1920,0,1920,1040),1.0));
    assert!(tiled((-12,-12,1944,3160),(0,0,2880,3120),1.5));
    assert!(!tiled((100,100,1600,1000),(0,0,2880,1920),1.5));
    println!("PASS floating, edge-only, halves, quarters, centered thirds, negative monitor coordinates and DPI tolerance");
}
