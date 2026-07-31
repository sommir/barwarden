pub const PRODUCT_NAME: &str = "Barwarden";
pub const BUNDLE_IDENTIFIER: &str = "com.sommir.barwarden";
// Ad-hoc development builds do not have a stable signing requirement. Release
// builds use a stable product-facing service name. The two device-identity
// records needed for trusted two-factor sign-in migrate once from prior names.
pub const RELEASE_KEYCHAIN_SERVICE: &str = "Barwarden Secure Storage";
pub const DEBUG_KEYCHAIN_SERVICE: &str = "Barwarden Debug";
pub const KEYCHAIN_ACCOUNT_PREFIX: &str = "barwarden:v1:";
pub const BIOMETRIC_ACCOUNT_PREFIX: &str = "barwarden:biometric:v2:";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_brand_identity_is_exact() {
        assert_eq!(PRODUCT_NAME, "Barwarden");
        assert_eq!(BUNDLE_IDENTIFIER, "com.sommir.barwarden");
        assert_eq!(RELEASE_KEYCHAIN_SERVICE, "Barwarden Secure Storage");
        assert_eq!(DEBUG_KEYCHAIN_SERVICE, "Barwarden Debug");
        assert_eq!(KEYCHAIN_ACCOUNT_PREFIX, "barwarden:v1:");
        assert_eq!(BIOMETRIC_ACCOUNT_PREFIX, "barwarden:biometric:v2:");
    }

    #[test]
    fn native_brand_module_is_registered_for_application_code() {
        let main = include_str!("main.rs");
        let registration = main
            .find("mod brand;")
            .expect("brand module registration must exist");
        assert!(
            !main[..registration].trim_end().ends_with("#[cfg(test)]"),
            "brand module must be registered without a test-only cfg"
        );
    }
}
