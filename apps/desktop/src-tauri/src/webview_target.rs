use tauri::Url;

/// Native navigation acceptance updates the applied home. Page navigation never writes this state.
pub struct Target {
    requested: Url,
    applied: Url,
}

impl Target {
    pub fn applied(home: Url) -> Self {
        Self { requested: home.clone(), applied: home }
    }

    pub fn reconcile(&mut self, home: Url, navigate: impl FnOnce(&Url) -> bool) -> bool {
        self.requested = home;
        if self.requested == self.applied {
            return true;
        }
        if !navigate(&self.requested) {
            return false;
        }
        self.applied = self.requested.clone();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_home_reuses_the_document_for_repeated_returns() {
        let mut target = Target::applied(Url::parse("http://localhost:3000").unwrap());
        for _ in 0..50 {
            assert!(target.reconcile(Url::parse("http://localhost:3000/").unwrap(), |_| {
                panic!("unchanged home must preserve any browsing location")
            }));
        }
    }

    #[test]
    fn meaningful_components_navigate_once_and_failed_navigation_is_retryable() {
        let mut target = Target::applied(Url::parse("http://localhost:3000/").unwrap());
        for home in ["http://localhost:3001/", "http://localhost:3001/settings", "http://localhost:3001/settings?q=1", "http://localhost:3001/settings?q=1#form"] {
            let home = Url::parse(home).unwrap();
            assert!(!target.reconcile(home.clone(), |_| false));
            assert_ne!(target.applied, home);
            assert!(target.reconcile(home.clone(), |next| next == &home));
            assert!(target.reconcile(home, |_| panic!("already applied")));
        }
    }

    #[test]
    fn returning_to_applied_home_cancels_a_failed_target() {
        let home = Url::parse("http://localhost:3000/").unwrap();
        let mut target = Target::applied(home.clone());
        assert!(!target.reconcile(Url::parse("http://localhost:3001/").unwrap(), |_| false));
        assert!(target.reconcile(home, |_| panic!("original target still applied")));
    }
}
