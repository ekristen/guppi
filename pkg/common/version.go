package common

// NAME of the App
var NAME = "guppi"

// SUMMARY of the Version
var SUMMARY = "v0.1.1-beta.2" // x-release-please-version

// BRANCH of the Version
var BRANCH = "dev"

// VERSION of Release
var VERSION = "0.1.1-beta.2" // x-release-please-version

var COMMIT = "dirty"

// AppVersion --
var AppVersion AppVersionInfo

// AppVersionInfo --
type AppVersionInfo struct {
	Name    string
	Version string
	Branch  string
	Summary string
	Commit  string
}

func init() {
	AppVersion = AppVersionInfo{
		Name:    NAME,
		Version: VERSION,
		Branch:  BRANCH,
		Summary: SUMMARY,
		Commit:  COMMIT,
	}
}
