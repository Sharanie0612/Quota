use std::path::Path;
pub fn write_csv(path:&Path,contents:&str)->Result<(),String>{
    if !path.is_absolute()||!path.extension().is_some_and(|ext|ext.eq_ignore_ascii_case("csv"))||contents.len()>4*1024*1024||contents.contains('\0') {
        return Err("请选择CSV文件，报表不能超过4MiB".into());
    }
    crate::storage::write_atomic(path,contents)
}
#[tauri::command]
pub fn export_report_csv(window:tauri::WebviewWindow,path:String,contents:String)->Result<(),String>{
    if window.label()!="main"{return Err("只能从主窗口导出报表".into())}
    write_csv(Path::new(&path),&contents)
}
