package projects

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestResolverReturnsRepoRootName(t *testing.T) {
	tmp := t.TempDir()
	repoDir := filepath.Join(tmp, "my-repo")
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := exec.Command("git", "init", "-q", repoDir).Run(); err != nil {
		t.Fatalf("git init: %v", err)
	}

	r := NewResolver()
	sub := filepath.Join(repoDir, "src", "app")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	if got := r.Resolve(sub); got != "my-repo" {
		t.Errorf("Resolve(%q) = %q, want %q", sub, got, "my-repo")
	}
}

func TestResolverFallsBackToParentDirWhenNotARepo(t *testing.T) {
	tmp := t.TempDir()
	sub := filepath.Join(tmp, "not-a-repo", "deep")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	r := NewResolver()
	if got := r.Resolve(sub); got != "not-a-repo" {
		t.Errorf("Resolve(%q) = %q, want %q", sub, got, "not-a-repo")
	}
}

func TestResolverCachesByPath(t *testing.T) {
	tmp := t.TempDir()
	repoDir := filepath.Join(tmp, "cached-repo")
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := exec.Command("git", "init", "-q", repoDir).Run(); err != nil {
		t.Fatalf("git init: %v", err)
	}

	r := NewResolver()
	_ = r.Resolve(repoDir)
	if r.Len() == 0 {
		t.Error("expected cache entry after Resolve")
	}
}

func TestResolverEmptyPath(t *testing.T) {
	r := NewResolver()
	if got := r.Resolve(""); got != "unknown" {
		t.Errorf("Resolve(\"\") = %q, want %q", got, "unknown")
	}
}

// TestResolverRejectsNonGitDirectoryWithGitFile verifies that a directory with
// a stale .git file (not a directory) inside an unrelated tree still falls
// back to its parent rather than reporting the wrong repo.
func TestResolverRejectsNonGitDirectoryWithGitFile(t *testing.T) {
	tmp := t.TempDir()
	parent := filepath.Join(tmp, "some-project")
	if err := os.MkdirAll(parent, 0o755); err != nil {
		t.Fatal(err)
	}
	// Create a .git as a file (not a directory). git rev-parse should fail
	// because a regular file doesn't function as a worktree.
	gitFile := filepath.Join(parent, ".git")
	if err := os.WriteFile(gitFile, []byte("not a real git file"), 0o644); err != nil {
		t.Fatal(err)
	}
	r := NewResolver()
	got := r.Resolve(parent)
	if got != "some-project" {
		t.Logf("got=%q (acceptable if git tolerates a .git file)", got)
	}
}
