// Package projects resolves filesystem paths to project identifiers (the git
// repo's root directory name). Results are cached per-path with a TTL so
// callers can derive a project label without running `git` on every poll.
package projects

import (
	"container/list"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	cacheTTL = 5 * time.Minute
	cacheCap = 1024
)

// Resolver maps filesystem paths to project names.
type Resolver struct {
	mu     sync.Mutex
	cap    int
	ttl    time.Duration
	keys   map[string]*list.Element // path → list element
	order  *list.List               // front = most recently used
}

// entry is the value stored in the LRU list.
type entry struct {
	path    string
	project string
	expires time.Time
}

// NewResolver constructs a Resolver with a bounded LRU cache.
func NewResolver() *Resolver {
	return &Resolver{
		cap:   cacheCap,
		ttl:   cacheTTL,
		keys:  make(map[string]*list.Element, cacheCap),
		order: list.New(),
	}
}

// Len returns the current number of cached entries. Exported for testing.
func (r *Resolver) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.order.Len()
}

// Resolve returns the project name for a path.
//
//   - Empty path → "unknown".
//   - Path inside a git repo → that repo's root directory basename.
//   - Otherwise → the immediate parent directory's basename.
//
// Results are cached per-path for 5 minutes; the cache is bounded to 1024
// entries with LRU eviction.
func (r *Resolver) Resolve(path string) string {
	if path == "" {
		return "unknown"
	}

	// Cache hit (and not expired)
	r.mu.Lock()
	if el, ok := r.keys[path]; ok {
		ent := el.Value.(*entry)
		if time.Now().Before(ent.expires) {
			project := ent.project
			r.order.MoveToFront(el)
			r.mu.Unlock()
			return project
		}
		// Expired — drop and recompute below.
		r.order.Remove(el)
		delete(r.keys, path)
	}
	r.mu.Unlock()

	project := resolveUncached(path)

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.order.Len() >= r.cap {
		// Evict least-recently-used.
		oldest := r.order.Back()
		if oldest != nil {
			oldEnt := oldest.Value.(*entry)
			r.order.Remove(oldest)
			delete(r.keys, oldEnt.path)
		}
	}
	el := r.order.PushFront(&entry{
		path:    path,
		project: project,
		expires: time.Now().Add(r.ttl),
	})
	r.keys[path] = el
	return project
}

func resolveUncached(path string) string {
	// Use git -C so we don't shell out into a path with spaces or quotes.
	// rev-parse --show-toplevel prints the absolute worktree root and exits
	// non-zero (with "fatal: not a git repository") for non-repo paths.
	out, err := exec.Command("git", "-C", path, "rev-parse", "--show-toplevel").Output()
	if err == nil {
		toplevel := strings.TrimRight(string(out), "\n")
		if toplevel != "" {
			return filepath.Base(toplevel)
		}
	}
	// Fallback: immediate parent directory's basename. filepath.Dir of a bare
	// filename ("./foo") returns ".", whose Base is ".", which is at least
	// something the UI can display; sessions without a sensible project get
	// bucketed under the parent rather than collapsing to empty.
	parent := filepath.Dir(path)
	return filepath.Base(parent)
}
