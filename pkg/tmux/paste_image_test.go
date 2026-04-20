package tmux

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStorePastedImage(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())

	path, err := StorePastedImage(base64.StdEncoding.EncodeToString([]byte("png-bytes")), "image/png", "clipboard.png")
	if err != nil {
		t.Fatalf("StorePastedImage returned error: %v", err)
	}
	if filepath.Ext(path) != ".png" {
		t.Fatalf("expected .png extension, got %q", filepath.Ext(path))
	}
	if !strings.Contains(path, filepath.Join("guppi-paste", "pasted-")) {
		t.Fatalf("expected guppi-paste temp path, got %q", path)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile returned error: %v", err)
	}
	if string(got) != "png-bytes" {
		t.Fatalf("expected written bytes to round-trip, got %q", string(got))
	}
}

func TestStorePastedImageRejectsInvalidMime(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())

	_, err := StorePastedImage(base64.StdEncoding.EncodeToString([]byte("not-an-image")), "text/plain", "notes.txt")
	if err == nil {
		t.Fatal("expected unsupported MIME type error")
	}
}

func TestStorePastedImageRejectsInvalidBase64(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())

	_, err := StorePastedImage("%%%not-base64%%%", "image/png", "broken.png")
	if err == nil {
		t.Fatal("expected invalid base64 error")
	}
}
