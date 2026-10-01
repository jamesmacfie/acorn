//! One live renderer, composed above untrusted page views. No second UI realm or action bridge.
use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, Runtime, Webview};

static EPOCH: AtomicU64 = AtomicU64::new(0);

fn authorized(label: &str, epoch: u64, current: u64, presentation: &Presentation) -> bool {
    label == "main" && epoch == current && presentation.valid()
}

pub fn newer(epoch: u64, generation: u64, previous_epoch: u64, previous_generation: u64) -> bool {
    epoch > previous_epoch || (epoch == previous_epoch && generation > previous_generation)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Bounds {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 100_000.0)
            && self.width >= 0.0
            && self.height >= 0.0
    }
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Surface {
    pub id: u64,
    pub role: String,
    pub bounds: Bounds,
    #[serde(default)]
    pub radius: [f64; 4],
    pub interactive: bool,
    pub modal: bool,
}
impl Surface {
    fn contains(&self, x: f64, y: f64) -> bool {
        if !self.bounds.contains(x, y) {
            return false;
        }
        let b = &self.bounds;
        let corners = [
            (b.x, b.y, 1., 1.),
            (b.x + b.width, b.y, -1., 1.),
            (b.x + b.width, b.y + b.height, -1., -1.),
            (b.x, b.y + b.height, 1., -1.),
        ];
        for (index, (cx, cy, sx, sy)) in corners.iter().enumerate() {
            let r = self.radius[index].min(b.width / 2.).min(b.height / 2.);
            let dx = (x - cx) * sx;
            let dy = (y - cy) * sy;
            if dx < r && dy < r && (dx - r).powi(2) + (dy - r).powi(2) > r * r {
                return false;
            }
        }
        true
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Page {
    pub bounds: Bounds,
    pub blockers: Vec<u64>,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Presentation {
    pub generation: u64,
    pub viewport: Option<Viewport>,
    pub pages: Vec<Page>,
    pub surfaces: Vec<Surface>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
}
impl Viewport {
    pub fn valid(&self) -> bool {
        [self.width, self.height]
            .iter()
            .all(|v| v.is_finite() && *v > 0.0 && *v <= 100_000.0)
    }
}
impl Presentation {
    fn valid(&self) -> bool {
        self.viewport.as_ref().map_or(true, Viewport::valid)
            && self.pages.len() <= 32
            && self.surfaces.len() <= 128
            && self
                .surfaces
                .iter()
                .enumerate()
                .all(|(i, s)| self.surfaces[..i].iter().all(|other| other.id != s.id))
            && self.pages.iter().all(|p| {
                p.bounds.valid()
                    && p.blockers.len() <= 128
                    && p.blockers
                        .iter()
                        .all(|id| self.surfaces.iter().any(|s| s.id == *id))
            })
            && self.surfaces.iter().all(|s| {
                s.id > 0
                    && s.bounds.valid()
                    && s.radius
                        .iter()
                        .all(|r| r.is_finite() && *r >= 0.0 && *r <= 100_000.0)
                    && matches!(
                        s.role.as_str(),
                        "tooltip" | "popover" | "menu" | "modal" | "toast" | "drawer" | "custom"
                    )
            })
    }
    pub fn passes_through(&self, x: f64, y: f64) -> bool {
        self.pages.iter().any(|p| {
            p.bounds.contains(x, y)
                && !self
                    .surfaces
                    .iter()
                    .any(|s| p.blockers.contains(&s.id) && s.interactive && s.contains(x, y))
        })
    }
}

// Custom Tauri commands must check the calling webview themselves. A window capability is not
// authority for preview pages, and these commands never accept executable markup or actions.
#[tauri::command]
pub fn overlay_begin<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> Option<u64> {
    if webview.label() != "main" {
        return None;
    }
    let epoch = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    // Reload invalidates the old realm before its first new presentation. Keep page instances,
    // but release old input regions and hide them until their new DOM owner attaches.
    crate::webviews::webview_hide_family(app.clone(), "preview:".into());
    crate::webviews::webview_hide_family(app.clone(), "plugin:".into());
    #[cfg(target_os = "macos")]
    if let Some(main) = app
        .get_webview("main")
        .filter(|_| std::env::var("ACORN_NATIVE_OVERLAYS").as_deref() != Ok("0"))
    {
        let handle = app.clone();
        let _ = main.with_webview(move |platform| {
            if epoch == EPOCH.load(Ordering::SeqCst) {
                macos::update(platform.inner(), epoch, Presentation::default(), handle);
            }
        });
    }
    Some(epoch)
}

#[tauri::command]
pub async fn overlay_update<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    epoch: u64,
    presentation: Presentation,
) -> bool {
    if !authorized(
        webview.label(),
        epoch,
        EPOCH.load(Ordering::SeqCst),
        &presentation,
    ) {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let Some(main) = app.get_webview("main") else {
            return false;
        };
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = app.clone();
        if main
            .with_webview(move |platform| {
                let applied = epoch == EPOCH.load(Ordering::SeqCst)
                    && macos::update(platform.inner(), epoch, presentation, handle);
                let _ = tx.send(applied);
            })
            .is_err()
        {
            return false;
        }
        tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(false))
            .await
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        false
    }
}

#[cfg(target_os = "macos")]
#[path = "overlays_macos.rs"]
mod macos;

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }
    #[test]
    fn passive_surfaces_pass_page_input_and_partial_interactive_overlap_blocks_it() {
        let mut p = Presentation {
            generation: 1,
            viewport: None,
            pages: vec![Page {
                bounds: rect(100., 100., 600., 400.),
                blockers: vec![1],
            }],
            surfaces: vec![Surface {
                id: 1,
                role: "tooltip".into(),
                bounds: rect(90., 90., 100., 40.),
                radius: [0.; 4],
                interactive: false,
                modal: false,
            }],
        };
        assert!(p.passes_through(120., 110.));
        assert!(!p.passes_through(20., 20.));
        p.surfaces[0].interactive = true;
        assert!(!p.passes_through(120., 110.));
        assert!(p.passes_through(400., 300.));
    }
    #[test]
    fn validation_bounds_payloads_and_rejects_unknown_roles() {
        let mut p = Presentation::default();
        assert!(p.valid());
        p.pages = vec![
            Page {
                bounds: rect(0., 0., 1., 1.),
                blockers: vec![]
            };
            33
        ];
        assert!(!p.valid());
        p.pages = vec![Page {
            bounds: rect(f64::NAN, 0., 1., 1.),
            blockers: vec![],
        }];
        assert!(!p.valid());
        assert!(!rect(0., 0., -1., 1.).valid());
        p.pages.clear();
        p.surfaces.push(Surface {
            id: 1,
            role: "unknown".into(),
            bounds: rect(0., 0., 100., 100.),
            radius: [20.; 4],
            interactive: true,
            modal: false,
        });
        assert!(!p.valid());
        p.surfaces[0].role = "popover".into();
        assert!(p.valid());
        assert!(!p.surfaces[0].contains(1., 1.));
        assert!(p.surfaces[0].contains(20., 20.));
    }
    #[test]
    fn page_commands_and_disposed_renderer_epochs_have_no_authority() {
        let p = Presentation::default();
        assert!(authorized("main", 2, 2, &p));
        assert!(!authorized("preview:task", 2, 2, &p));
        assert!(!authorized("plugin:example", 2, 2, &p));
        assert!(!authorized("main", 1, 2, &p));
        assert!(!newer(2, 1, 2, 2));
        assert!(!newer(1, 99, 2, 2));
        assert!(newer(3, 0, 2, 99));
    }
}

/// Restore sibling ordering after a page is created/shown or its inspector attaches.
pub fn raise<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    if let Some(main) = app.get_webview("main") {
        let _ = main.with_webview(|platform| macos::raise(platform.inner()));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// The isolated agent fixture must be foreground for WebKit's visibility-gated work to run.
/// This command is inert in ordinary builds and never available to page webviews.
#[tauri::command]
pub fn overlay_debug_focus<R: Runtime>(app: AppHandle<R>, webview: Webview<R>) -> bool {
    if !cfg!(feature = "agent-automation") || webview.label() != "main" {
        return false;
    }
    #[cfg(target_os = "macos")]
    if let Some(main) = app.get_webview("main") {
        return main.with_webview(|_| macos::activate_agent()).is_ok();
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(main) = app.get_window("main") {
        return main.set_focus().is_ok();
    }
    false
}
