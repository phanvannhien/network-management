package secrets

// AAD of every kind of stored secret, in one place: a sealed value only opens on its own row, and master key
// rotation rebuilds exactly these.

// CredentialAAD binds a device credential's secret to its row (P2-02).
func CredentialAAD(id string) []byte { return []byte("credential:" + id) }

// CloudAccountAAD binds a cloud account's password to its row (P2-03).
func CloudAccountAAD(id string) []byte { return []byte("cloud_account:" + id) }

// TOTPAAD binds a user's TOTP seed to the user (P1-02).
func TOTPAAD(userID string) []byte { return []byte("totp:" + userID) }

// SMTPPasswordAAD binds the installation's SMTP password to its purpose (P2-05).
var SMTPPasswordAAD = []byte("smtp_settings.password")

// BackupTargetAAD binds a backup destination's sealed secrets to its row.
func BackupTargetAAD(id string) []byte { return []byte("backup_target:" + id) }
