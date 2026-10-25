//! The semantic Windows host profile, and the PURE classification that produces it.
//!
//! Only activation-relevant facts are modelled: version numbers, build, an edition CLASS, and a
//! client/server split. Deliberately absent — with no field to hold them — are the machine name,
//! product key, installation or device identifier, domain, user name, account SID, serial number,
//! registry values and private paths.
//!
//! Classification is a pure function of raw numeric facts, so every branch is testable on any
//! platform. An unknown edition NEVER becomes supported: it classifies as
//! [`WindowsEditionClass::UnknownClient`] or [`WindowsEditionClass::Indeterminate`], both of which
//! fail the baseline check.

/// The lowest Windows client major version the host service targets.
const MIN_SUPPORTED_MAJOR: u32 = 10;

// Documented `GetProductInfo` values, grouped by the class they belong to.
const PRODUCT_CORE: u32 = 0x0000_0065; // Home
const PRODUCT_CORE_N: u32 = 0x0000_0062;
const PRODUCT_CORE_COUNTRYSPECIFIC: u32 = 0x0000_0063;
const PRODUCT_CORE_SINGLELANGUAGE: u32 = 0x0000_0064;
const PRODUCT_PROFESSIONAL: u32 = 0x0000_0030;
const PRODUCT_PROFESSIONAL_N: u32 = 0x0000_0031;
const PRODUCT_ENTERPRISE: u32 = 0x0000_0004;
const PRODUCT_ENTERPRISE_N: u32 = 0x0000_001B;
const PRODUCT_EDUCATION: u32 = 0x0000_0079;
const PRODUCT_EDUCATION_N: u32 = 0x0000_007A;
/// `PRODUCT_UNDEFINED` — the API answered, but with nothing usable.
const PRODUCT_UNDEFINED: u32 = 0x0000_0000;

/// `VER_NT_WORKSTATION`.
pub(crate) const VER_NT_WORKSTATION: u8 = 1;

/// The semantic edition class. Never a marketing string, never a licence identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum WindowsEditionClass {
    /// Home / Core editions.
    ClientHome,
    /// Professional editions.
    ClientProfessional,
    /// Enterprise editions.
    ClientEnterprise,
    /// Education editions.
    ClientEducation,
    /// Any server product type.
    Server,
    /// A client whose product value this crate does not recognise.
    UnknownClient,
    /// Below the supported Windows baseline.
    Unsupported,
    /// The facts could not be obtained at all.
    Indeterminate,
}

impl WindowsEditionClass {
    /// Whether this class is a recognised CLIENT edition.
    #[must_use]
    pub fn is_known_client(self) -> bool {
        matches!(
            self,
            Self::ClientHome
                | Self::ClientProfessional
                | Self::ClientEnterprise
                | Self::ClientEducation
        )
    }
}

/// Native processor architecture, where it matters for activation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostArchitecture {
    /// x64.
    X64,
    /// ARM64.
    Arm64,
    /// 32-bit x86.
    X86,
    /// Anything else, or unobtainable.
    Other,
}

impl HostArchitecture {
    /// Classify a `SYSTEM_INFO.wProcessorArchitecture` value.
    #[must_use]
    pub fn from_raw(value: u16) -> Self {
        match value {
            9 => Self::X64,
            12 => Self::Arm64,
            0 => Self::X86,
            _ => Self::Other,
        }
    }
}

/// The activation-relevant Windows profile. Immutable once collected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowsClientProfile {
    major: u32,
    minor: u32,
    build: u32,
    edition: WindowsEditionClass,
    is_client: bool,
    architecture: HostArchitecture,
}

impl WindowsClientProfile {
    /// Classify raw numeric facts into a semantic profile. PURE — no Windows call, no I/O.
    ///
    /// `product_type` is the `OSVERSIONINFOEXW.wProductType` byte; `product_info` is the
    /// `GetProductInfo` result, or `None` when the API gave no answer.
    #[must_use]
    pub fn classify(
        major: u32,
        minor: u32,
        build: u32,
        product_type: u8,
        product_info: Option<u32>,
        architecture: HostArchitecture,
    ) -> Self {
        let is_client = product_type == VER_NT_WORKSTATION;
        let edition = if major < MIN_SUPPORTED_MAJOR {
            // Below the baseline the edition is irrelevant — it can never be supported.
            WindowsEditionClass::Unsupported
        } else if !is_client {
            WindowsEditionClass::Server
        } else {
            match product_info {
                None | Some(PRODUCT_UNDEFINED) => WindowsEditionClass::Indeterminate,
                Some(
                    PRODUCT_CORE
                    | PRODUCT_CORE_N
                    | PRODUCT_CORE_COUNTRYSPECIFIC
                    | PRODUCT_CORE_SINGLELANGUAGE,
                ) => WindowsEditionClass::ClientHome,
                Some(PRODUCT_PROFESSIONAL | PRODUCT_PROFESSIONAL_N) => {
                    WindowsEditionClass::ClientProfessional
                }
                Some(PRODUCT_ENTERPRISE | PRODUCT_ENTERPRISE_N) => {
                    WindowsEditionClass::ClientEnterprise
                }
                Some(PRODUCT_EDUCATION | PRODUCT_EDUCATION_N) => {
                    WindowsEditionClass::ClientEducation
                }
                // A client edition this crate does not recognise. It does NOT become supported.
                Some(_) => WindowsEditionClass::UnknownClient,
            }
        };
        Self {
            major,
            minor,
            build,
            edition,
            is_client,
            architecture,
        }
    }

    /// A profile for a host whose facts could not be obtained at all.
    #[must_use]
    pub fn indeterminate() -> Self {
        Self {
            major: 0,
            minor: 0,
            build: 0,
            edition: WindowsEditionClass::Indeterminate,
            is_client: false,
            architecture: HostArchitecture::Other,
        }
    }

    /// Major version.
    #[must_use]
    pub fn major(&self) -> u32 {
        self.major
    }
    /// Minor version.
    #[must_use]
    pub fn minor(&self) -> u32 {
        self.minor
    }
    /// Build number.
    #[must_use]
    pub fn build(&self) -> u32 {
        self.build
    }
    /// Semantic edition class.
    #[must_use]
    pub fn edition(&self) -> WindowsEditionClass {
        self.edition
    }
    /// Whether this is a client (workstation) product type.
    #[must_use]
    pub fn is_client(&self) -> bool {
        self.is_client
    }
    /// Native architecture.
    #[must_use]
    pub fn architecture(&self) -> HostArchitecture {
        self.architecture
    }

    /// Whether the host meets the supported baseline.
    ///
    /// A recognised client edition at or above the baseline major version. `UnknownClient`,
    /// `Indeterminate`, `Unsupported` and `Server` all return `false` — an unknown edition is never
    /// promoted to supported.
    #[must_use]
    pub fn meets_baseline(&self) -> bool {
        self.major >= MIN_SUPPORTED_MAJOR && self.is_client && self.edition.is_known_client()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_supported_home_client_is_classified_and_meets_the_baseline() {
        let p = WindowsClientProfile::classify(
            10,
            0,
            26_200,
            VER_NT_WORKSTATION,
            Some(PRODUCT_CORE),
            HostArchitecture::X64,
        );
        assert_eq!(p.edition(), WindowsEditionClass::ClientHome);
        assert!(p.is_client());
        assert!(p.meets_baseline());
        assert_eq!(p.architecture(), HostArchitecture::X64);
    }

    #[test]
    fn each_recognised_client_edition_maps_to_its_class() {
        for (raw, expected) in [
            (PRODUCT_CORE, WindowsEditionClass::ClientHome),
            (PRODUCT_CORE_N, WindowsEditionClass::ClientHome),
            (PRODUCT_CORE_SINGLELANGUAGE, WindowsEditionClass::ClientHome),
            (
                PRODUCT_PROFESSIONAL,
                WindowsEditionClass::ClientProfessional,
            ),
            (
                PRODUCT_PROFESSIONAL_N,
                WindowsEditionClass::ClientProfessional,
            ),
            (PRODUCT_ENTERPRISE, WindowsEditionClass::ClientEnterprise),
            (PRODUCT_EDUCATION, WindowsEditionClass::ClientEducation),
        ] {
            let p = WindowsClientProfile::classify(
                10,
                0,
                26_200,
                VER_NT_WORKSTATION,
                Some(raw),
                HostArchitecture::X64,
            );
            assert_eq!(p.edition(), expected, "product {raw:#x}");
            assert!(p.meets_baseline());
        }
    }

    #[test]
    fn an_unknown_client_edition_never_becomes_supported() {
        let p = WindowsClientProfile::classify(
            10,
            0,
            26_200,
            VER_NT_WORKSTATION,
            Some(0x0000_0FFF),
            HostArchitecture::X64,
        );
        assert_eq!(p.edition(), WindowsEditionClass::UnknownClient);
        assert!(!p.edition().is_known_client());
        assert!(!p.meets_baseline(), "unknown must not be promoted");
    }

    #[test]
    fn a_server_product_type_is_classified_as_server() {
        let p = WindowsClientProfile::classify(
            10,
            0,
            20_348,
            3, // VER_NT_SERVER
            Some(PRODUCT_ENTERPRISE),
            HostArchitecture::X64,
        );
        assert_eq!(p.edition(), WindowsEditionClass::Server);
        assert!(!p.is_client());
        assert!(!p.meets_baseline());
    }

    #[test]
    fn a_below_baseline_version_is_unsupported_regardless_of_edition() {
        let p = WindowsClientProfile::classify(
            6,
            1,
            7601,
            VER_NT_WORKSTATION,
            Some(PRODUCT_PROFESSIONAL),
            HostArchitecture::X64,
        );
        assert_eq!(p.edition(), WindowsEditionClass::Unsupported);
        assert!(!p.meets_baseline());
    }

    #[test]
    fn a_missing_product_api_answer_is_indeterminate_not_supported() {
        for info in [None, Some(PRODUCT_UNDEFINED)] {
            let p = WindowsClientProfile::classify(
                10,
                0,
                26_200,
                VER_NT_WORKSTATION,
                info,
                HostArchitecture::X64,
            );
            assert_eq!(p.edition(), WindowsEditionClass::Indeterminate);
            assert!(!p.meets_baseline());
        }
        let unknown = WindowsClientProfile::indeterminate();
        assert_eq!(unknown.edition(), WindowsEditionClass::Indeterminate);
        assert!(!unknown.meets_baseline());
    }

    #[test]
    fn the_profile_carries_no_machine_identity() {
        let p = WindowsClientProfile::classify(
            10,
            0,
            26_200,
            VER_NT_WORKSTATION,
            Some(PRODUCT_CORE),
            HostArchitecture::X64,
        );
        let text = format!("{p:?}");
        // Only numbers and semantic class names may appear.
        assert!(text.contains("ClientHome"));
        assert!(!text.contains('\\'), "no path separator");
        assert!(!text.contains("S-1-"), "no SID");
        assert!(!text.to_ascii_lowercase().contains("user"));
        assert!(!text.to_ascii_lowercase().contains("machine"));
    }

    #[test]
    fn architecture_classification_is_bounded() {
        assert_eq!(HostArchitecture::from_raw(9), HostArchitecture::X64);
        assert_eq!(HostArchitecture::from_raw(12), HostArchitecture::Arm64);
        assert_eq!(HostArchitecture::from_raw(0), HostArchitecture::X86);
        assert_eq!(HostArchitecture::from_raw(0xFFFF), HostArchitecture::Other);
    }
}
