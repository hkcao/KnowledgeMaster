use crate::{models::ExtractedDocument, store::error};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

const VERSION: &str = "4.0.12-basic-onnx-v1";
const WORKER: &str = include_str!("ocr_worker.py");
const UV_VERSION: &str = "0.13.6";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrStatus {
    pub ready: bool,
    pub installing: bool,
    pub detail: String,
    pub directory: String,
}

#[derive(Deserialize)]
struct Manifest {
    version: String,
    files: HashMap<String, u64>,
}

pub struct Runtime {
    root: PathBuf,
    setup_lock: Mutex<()>,
    inference_lock: Mutex<()>,
    cancelled: AtomicBool,
    progress: Mutex<(bool, String)>,
    processes: Mutex<HashSet<u32>>,
}

pub fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        Runtime::new(
            dirs::data_local_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("KnowledgeMaster")
                .join("ocr")
                .join(VERSION),
        )
    })
}

impl Runtime {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            setup_lock: Mutex::new(()),
            inference_lock: Mutex::new(()),
            cancelled: AtomicBool::new(false),
            progress: Mutex::new((false, String::new())),
            processes: Mutex::new(HashSet::new()),
        }
    }

    fn python(&self) -> PathBuf {
        self.root.join(if cfg!(windows) {
            "venv/Scripts/python.exe"
        } else {
            "venv/bin/python"
        })
    }

    fn ready(&self) -> bool {
        let manifest = fs::read(self.root.join("ready.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Manifest>(&bytes).ok());
        self.python().is_file()
            && manifest.is_some_and(|manifest| {
                manifest.version == VERSION
                    && !manifest.files.is_empty()
                    && manifest.files.iter().all(|(path, size)| {
                        let path = Path::new(path);
                        !path.is_absolute()
                            && path
                                .components()
                                .all(|part| matches!(part, Component::Normal(_)))
                            && *size > 0
                            && fs::metadata(self.root.join(path))
                                .is_ok_and(|value| value.is_file() && value.len() == *size)
                    })
            })
    }

    pub fn status(&self) -> OcrStatus {
        let (installing, detail) = self.progress.lock().unwrap().clone();
        OcrStatus {
            ready: self.ready(),
            installing,
            detail,
            directory: self.root.to_string_lossy().into_owned(),
        }
    }

    fn progress(&self, detail: &str) {
        *self.progress.lock().unwrap() = (true, detail.into());
        #[cfg(test)]
        eprintln!("{detail}");
    }

    pub fn cancel_setup(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn stop_all(&self) {
        self.cancel_setup();
        for pid in self.processes.lock().unwrap().iter().copied() {
            terminate(pid);
        }
    }

    pub fn setup(&self, source: &str) -> Result<OcrStatus, String> {
        if !["auto", "huggingface", "modelscope"].contains(&source) {
            return Err("不支持的模型下载源".into());
        }
        let _setup = self
            .setup_lock
            .try_lock()
            .map_err(|_| "OCR 正在下载，请等待或取消")?;
        self.cancelled.store(false, Ordering::Relaxed);
        let result = self.install(source);
        *self.progress.lock().unwrap() = (
            false,
            match &result {
                Ok(()) => "本地 CPU OCR 已就绪；刷新目录可重试失败文件".into(),
                Err(message) => format!("OCR 安装未完成：{message}；可重新下载以重试"),
            },
        );
        result.map(|()| self.status())
    }

    fn install(&self, source: &str) -> Result<(), String> {
        if self.ready() {
            return Ok(());
        }
        fs::create_dir_all(&self.root).map_err(error)?;
        fs::write(
            self.root.join("config.yaml"),
            "model:\n  small_backend: onnx\n  source: local\n",
        )
        .map_err(error)?;
        self.progress("正在下载 OCR 安装工具…");
        let uv = self.install_uv()?;
        if !self.python().is_file() {
            self.progress("正在下载独立 Python 3.12 环境…");
            self.run(
                self.command(&uv)
                    .args(["venv", "--python", "3.12", "--managed-python"])
                    .arg(self.root.join("venv")),
                Duration::from_secs(900),
                true,
            )?;
        }
        self.progress("正在安装 MinerU 4.0.12 与 CPU 运行库，首次安装可能需要数分钟…");
        self.run(
            self.command(&uv)
                .args(["pip", "install", "--python"])
                .arg(self.python())
                .arg("mineru==4.0.12"),
            Duration::from_secs(1800),
            true,
        )?;
        self.progress("正在下载并校验 Basic ONNX 模型（约 0.8 GB），可取消后重试…");
        let manifest = self.root.join("ready.json");
        self.run(
            self.worker()
                .arg("setup")
                .arg(&manifest)
                .arg(source)
                .env("MINERU_MODEL_SOURCE", source),
            Duration::from_secs(3600),
            true,
        )?;
        if !self.ready() {
            return Err("模型校验未通过，请重试下载".into());
        }
        // Installed environments retain their own files; only installer cache is disposable.
        let _ = fs::remove_dir_all(self.root.join("uv-cache"));
        Ok(())
    }

    fn command(&self, program: &Path) -> Command {
        let mut command = Command::new(program);
        // Isolate MinerU from user/global configs, especially remote API settings.
        for (key, _) in std::env::vars_os() {
            if key.to_string_lossy().starts_with("MINERU_") {
                command.env_remove(key);
            }
        }
        command
            .env("MINERU_HOME", self.root.join("home"))
            .env("MINERU_CONFIG", self.root.join("config.yaml"))
            .env("MINERU_MODEL_BASE_DIR", self.root.join("models"))
            .env("MINERU_MODEL_SMALL_BACKEND", "onnx")
            .env("MINERU_MODEL_SOURCE", "local")
            .env("MINERU_TABLE_DEVICE", "cpu")
            .env("MINERU_INTRA_OP_NUM_THREADS", "4")
            .env("MINERU_INTER_OP_NUM_THREADS", "1")
            .env("CUDA_VISIBLE_DEVICES", "")
            .env("UV_PYTHON_INSTALL_DIR", self.root.join("python"))
            .env("UV_CACHE_DIR", self.root.join("uv-cache"))
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .stdin(Stdio::null());
        command
    }

    fn worker(&self) -> Command {
        let mut command = self.command(&self.python());
        command.args(["-I", "-c", WORKER]);
        command
    }

    fn run(
        &self,
        command: &mut Command,
        timeout: Duration,
        cancellable: bool,
    ) -> Result<(), String> {
        if cancellable && self.cancelled.load(Ordering::Relaxed) {
            return Err("已取消下载".into());
        }
        let mut log = tempfile::tempfile().map_err(error)?;
        command
            .stdout(Stdio::from(log.try_clone().map_err(error)?))
            .stderr(Stdio::from(log.try_clone().map_err(error)?));
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = RunningChild {
            child: command.spawn().map_err(error)?,
            runtime: self,
        };
        self.processes.lock().unwrap().insert(child.child.id());
        let start = Instant::now();
        loop {
            if cancellable && self.cancelled.load(Ordering::Relaxed) {
                return Err("已取消下载".into());
            }
            if start.elapsed() >= timeout {
                return Err("OCR 处理超时".into());
            }
            if let Some(status) = child.child.try_wait().map_err(error)? {
                if status.success() {
                    return Ok(());
                }
                let length = log.metadata().map_err(error)?.len();
                log.seek(SeekFrom::Start(length.saturating_sub(3000)))
                    .map_err(error)?;
                let mut tail = vec![];
                log.read_to_end(&mut tail).map_err(error)?;
                return Err(format!(
                    "本地 OCR 进程失败（{status}）：{}",
                    String::from_utf8_lossy(&tail)
                ));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn install_uv(&self) -> Result<PathBuf, String> {
        let (archive, digest) = uv_asset(std::env::consts::OS, std::env::consts::ARCH)?;
        let destination = self.root.join(if cfg!(windows) { "uv.exe" } else { "uv" });
        if destination.is_file() {
            return Ok(destination);
        }
        let url =
            format!("https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/{archive}");
        let mut response = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(error)?
            .get(url)
            .send()
            .map_err(error)?
            .error_for_status()
            .map_err(error)?;
        let staging = tempfile::tempdir_in(&self.root).map_err(error)?;
        let archive_path = staging.path().join(archive);
        let mut output = fs::File::create(&archive_path).map_err(error)?;
        let mut hash = Sha256::new();
        let mut buffer = [0; 64 * 1024];
        loop {
            if self.cancelled.load(Ordering::Relaxed) {
                return Err("已取消下载".into());
            }
            let count = response.read(&mut buffer).map_err(error)?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
            output.write_all(&buffer[..count]).map_err(error)?;
        }
        drop(output);
        if format!("{:x}", hash.finalize()) != digest {
            return Err("OCR 安装工具 SHA-256 校验失败".into());
        }
        let binary = staging
            .path()
            .join(if cfg!(windows) { "uv.exe" } else { "uv" });
        if cfg!(windows) {
            let mut zip = zip::ZipArchive::new(fs::File::open(&archive_path).map_err(error)?)
                .map_err(error)?;
            let mut entry = zip.by_name("uv.exe").map_err(error)?;
            std::io::copy(&mut entry, &mut fs::File::create(&binary).map_err(error)?)
                .map_err(error)?;
        } else {
            let member = format!("{}/uv", archive.trim_end_matches(".tar.gz"));
            self.run(
                Command::new("/usr/bin/tar")
                    .args(["-xzf"])
                    .arg(&archive_path)
                    .args(["--strip-components=1", "-C"])
                    .arg(staging.path())
                    .arg(member),
                Duration::from_secs(30),
                true,
            )?;
        }
        fs::rename(binary, &destination).map_err(error)?;
        Ok(destination)
    }

    pub fn extract(&self, source: &Path, pages: &str) -> Result<ExtractedDocument, String> {
        if !self.ready() {
            return Err("本地 OCR 尚未就绪，请在设置中下载 CPU OCR 模型后刷新重试".into());
        }
        let _inference = self.inference_lock.lock().map_err(error)?;
        let mut hasher = Sha256::new();
        let mut file = fs::File::open(source).map_err(error)?;
        let mut buffer = [0; 64 * 1024];
        loop {
            let count = file.read(&mut buffer).map_err(error)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        hasher.update(VERSION.as_bytes());
        hasher.update(pages.as_bytes());
        let cache_dir = self.root.join("cache");
        fs::create_dir_all(&cache_dir).map_err(error)?;
        let cache = cache_dir.join(format!("{:x}.json", hasher.finalize()));
        if let Ok(bytes) = fs::read(&cache) {
            if let Ok(extracted) = serde_json::from_slice::<ExtractedDocument>(&bytes) {
                if !extracted.pages.is_empty() {
                    return Ok(extracted);
                }
            }
        }
        let staging = tempfile::tempdir_in(&cache_dir).map_err(error)?;
        let output = staging.path().join("extracted.json");
        self.run(
            self.worker()
                .arg("extract")
                .arg(source)
                .arg(&output)
                .arg(pages)
                .env("HF_HUB_OFFLINE", "1")
                .env("MODELSCOPE_OFFLINE", "1"),
            Duration::from_secs(1800),
            false,
        )?;
        let bytes = fs::read(&output).map_err(error)?;
        let extracted: ExtractedDocument = serde_json::from_slice(&bytes).map_err(error)?;
        if extracted.pages.is_empty() || extracted.pages.iter().any(|page| page.number == 0) {
            return Err("OCR 没有返回有效页码".into());
        }
        let mut temporary = tempfile::NamedTempFile::new_in(&cache_dir).map_err(error)?;
        temporary.write_all(&bytes).map_err(error)?;
        temporary.persist(cache).map_err(error)?;
        Ok(extracted)
    }
}

struct RunningChild<'a> {
    child: Child,
    runtime: &'a Runtime,
}
impl Drop for RunningChild<'_> {
    fn drop(&mut self) {
        // Also stop render workers / installers spawned by this child.
        if self.child.try_wait().ok().flatten().is_none() {
            terminate(self.child.id());
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        self.runtime
            .processes
            .lock()
            .unwrap()
            .remove(&self.child.id());
    }
}

#[cfg(unix)]
fn terminate(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
#[cfg(windows)]
fn terminate(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn uv_asset(os: &str, arch: &str) -> Result<(&'static str, &'static str), String> {
    match (os, arch) {
        ("macos", "aarch64") => Ok((
            "uv-aarch64-apple-darwin.tar.gz",
            "60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472",
        )),
        ("macos", "x86_64") => Ok((
            "uv-x86_64-apple-darwin.tar.gz",
            "63ba17fdda55ad1a230d4b37fc6017ffa10c23688c83818bd3bfdf914c652a02",
        )),
        ("windows", "x86_64") => Ok((
            "uv-x86_64-pc-windows-msvc.zip",
            "a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f",
        )),
        _ => Err("本地 OCR 暂支持 Windows x64 和 macOS".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_rejects_incomplete_changed_and_unsafe_model_manifests() {
        let directory = tempfile::tempdir().unwrap();
        let runtime = Runtime::new(directory.path().to_path_buf());
        fs::create_dir_all(runtime.python().parent().unwrap()).unwrap();
        fs::write(runtime.python(), "test runtime").unwrap();
        fs::write(directory.path().join("model.onnx"), "model").unwrap();
        let marker = directory.path().join("ready.json");
        for manifest in [
            serde_json::json!({"version": VERSION, "files": {}}),
            serde_json::json!({"version": "old", "files": {"model.onnx": 5}}),
            serde_json::json!({"version": VERSION, "files": {"model.onnx": 10}}),
            serde_json::json!({"version": VERSION, "files": {"../model.onnx": 5}}),
        ] {
            fs::write(&marker, serde_json::to_vec(&manifest).unwrap()).unwrap();
            assert!(!runtime.ready());
        }
        fs::write(
            &marker,
            serde_json::to_vec(
                &serde_json::json!({"version": VERSION, "files": {"model.onnx": 5}}),
            )
            .unwrap(),
        )
        .unwrap();
        assert!(runtime.ready());
        fs::remove_file(directory.path().join("model.onnx")).unwrap();
        assert!(!runtime.ready());
    }

    #[test]
    fn runtime_timeout_and_cancel_stop_children_and_allow_retry() {
        let directory = tempfile::tempdir().unwrap();
        let runtime = Runtime::new(directory.path().to_path_buf());
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd.exe");
            command.args(["/C", "ping -n 10 127.0.0.1 >NUL"]);
            command
        } else {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "sleep 10"]);
            command
        };
        let started = Instant::now();
        assert!(runtime
            .run(&mut command, Duration::from_millis(100), false)
            .unwrap_err()
            .contains("超时"));
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(runtime.processes.lock().unwrap().is_empty());
        runtime.cancel_setup();
        assert!(runtime
            .run(
                &mut Command::new("not-a-program"),
                Duration::from_secs(1),
                true
            )
            .unwrap_err()
            .contains("已取消"));
        assert!(!runtime.status().ready);
        assert!(runtime.setup("unsupported-source").is_err());
    }

    #[test]
    #[ignore = "Downloads the isolated Python, MinerU runtime and Basic models; runs real CPU inference"]
    fn real_cpu_ocr_smoke() {
        let root = std::env::temp_dir().join("KnowledgeMaster-ocr-smoke");
        let runtime = Runtime::new(root.clone());
        runtime.setup("auto").unwrap();
        let input = root.join("scanned-test.pdf");
        let create = r#"from PIL import Image, ImageDraw, ImageFont
import sys
pages = []
for label in ['First page KnowledgeMaster CPU OCR test 12345', 'Second page offline recognition 67890']:
    image = Image.new('RGB', (1600, 600), 'white')
    ImageDraw.Draw(image).text((60, 100), label, fill='black', font=ImageFont.load_default(size=42))
    pages.append(image)
pages[0].save(sys.argv[1], save_all=True, append_images=pages[1:])
"#;
        runtime
            .run(
                runtime
                    .command(&runtime.python())
                    .args(["-I", "-c", create])
                    .arg(&input),
                Duration::from_secs(30),
                false,
            )
            .unwrap();
        let inference_started = Instant::now();
        let extracted = runtime.extract(&input, "all").unwrap();
        eprintln!("CPU inference elapsed: {:?}", inference_started.elapsed());
        eprintln!("CPU OCR result: {:?}", extracted);
        assert_eq!(extracted.pages.len(), 2);
        assert_eq!(extracted.pages[0].number, 1);
        assert_eq!(extracted.pages[1].number, 2);
        assert!(extracted.text.to_lowercase().contains("knowledge"));
        assert!(extracted.pages[1].text.to_lowercase().contains("second"));
        let started = Instant::now();
        let cached = runtime.extract(&input, "all").unwrap();
        assert_eq!(cached.text, extracted.text);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
