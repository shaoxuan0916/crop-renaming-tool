use std::fmt::{Display, Formatter};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Debug)]
pub enum WorkflowError {
    FileNotFound,
    UnsupportedFormat,
    ConversionFailed(String),
    ConverterMissing,
    MissingPreparedImage,
    MissingFirstToken,
    MissingFinalPath,
    FilenameCollision(String),
    Io(std::io::Error),
}

impl Display for WorkflowError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            WorkflowError::FileNotFound => write!(f, "The dropped file could not be found."),
            WorkflowError::UnsupportedFormat => {
                write!(f, "The dropped file could not be converted to WebP.")
            }
            WorkflowError::ConversionFailed(message) => write!(f, "WebP conversion failed: {message}"),
            WorkflowError::ConverterMissing => {
                write!(f, "WebP conversion requires cwebp.exe in resources/bin/windows or PATH.")
            }
            WorkflowError::MissingPreparedImage => write!(f, "This item is missing its prepared WebP file."),
            WorkflowError::MissingFirstToken => write!(f, "Set the batch first token before finalizing files."),
            WorkflowError::MissingFinalPath => write!(f, "The final file path is missing for this item."),
            WorkflowError::FilenameCollision(path) => {
                write!(f, "A file already exists at {path}.")
            }
            WorkflowError::Io(error) => write!(f, "{error}"),
        }
    }
}

impl From<std::io::Error> for WorkflowError {
    fn from(value: std::io::Error) -> Self {
        WorkflowError::Io(value)
    }
}

pub fn ensure_directory(path: &Path) -> Result<(), WorkflowError> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    Ok(())
}

pub fn move_replacing_existing(source: &Path, destination: &Path) -> Result<(), WorkflowError> {
    if destination.exists() {
        if destination.is_dir() {
            fs::remove_dir_all(destination)?;
        } else {
            fs::remove_file(destination)?;
        }
    }

    if let Some(parent) = destination.parent() {
        ensure_directory(parent)?;
    }

    fs::rename(source, destination)?;
    Ok(())
}

pub fn cleanup_item(temp_webp_path: &Option<String>, backup_path: Option<&PathBuf>) {
    if let Some(path) = temp_webp_path.as_ref() {
        let target = PathBuf::from(path);
        if target.exists() {
            let _ = fs::remove_file(target);
        }
    }

    if let Some(path) = backup_path {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
}

pub fn build_final_filename(first_token: &str, suffix: &str) -> String {
    let first = sanitize_filename_segment(first_token);
    let suffix = sanitize_filename_segment(suffix);

    if suffix.is_empty() {
        return first;
    }

    if first.is_empty() {
        return suffix;
    }

    format!("{first}_{suffix}")
}

pub fn sanitize_filename_segment(input: &str) -> String {
    let invalid = "/\\?%*|\"<>:\n\r\t";
    let mut normalized = String::new();
    let mut last_was_underscore = false;

    for ch in input.trim().chars() {
        let replacement = if ch.is_whitespace() || invalid.contains(ch) { '_' } else { ch };

        if replacement == '_' {
            if !last_was_underscore {
                normalized.push('_');
            }
            last_was_underscore = true;
        } else {
            normalized.push(replacement);
            last_was_underscore = false;
        }
    }

    normalized
        .trim_matches(|ch| ch == '_' || ch == '.' || ch == ' ')
        .to_string()
}

pub fn convert_image_to_webp(
    app: &AppHandle,
    input_path: &Path,
    output_path: &Path,
) -> Result<(), WorkflowError> {
    let converter = resolve_cwebp_executable(app).ok_or(WorkflowError::ConverterMissing)?;
    if let Some(parent) = output_path.parent() {
        ensure_directory(parent)?;
    }

    let output = Command::new(converter)
        .args(["-quiet", "-q", "90"])
        .arg(input_path)
        .args(["-o"])
        .arg(output_path)
        .output()
        .map_err(WorkflowError::Io)?;

    if output.status.success() && output_path.exists() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = [stderr, stdout]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    Err(WorkflowError::ConversionFailed(if details.is_empty() {
        "cwebp failed to create the WebP file.".to_string()
    } else {
        details
    }))
}

fn resolve_cwebp_executable(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("bin").join("windows").join("cwebp.exe");
        if bundled.is_file() {
            return Some(bundled);
        }
    }

    if let Some(search_path) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&search_path) {
            let candidate = path.join("cwebp.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}
