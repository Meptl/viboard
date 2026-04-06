# V7 Config Theme Compatibility

V7 migration now delegates to the full v6 conversion chain so old configs still upgrade correctly instead of requiring a strict v6-shaped payload.

The migration path uses [[crates/services/src/services/config/versions/v7.rs#Config#from_previous_version]] to call `v6::Config::from(...)`, preserving version-by-version upgrades from older schemas before applying v7 theme mapping.
