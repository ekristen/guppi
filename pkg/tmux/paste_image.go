package tmux

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxPastedImageBytes = 10 << 20

type PTYControlMessage struct {
	Type     string `json:"type"`
	Cols     uint16 `json:"cols,omitempty"`
	Rows     uint16 `json:"rows,omitempty"`
	Data     string `json:"data,omitempty"`
	Mime     string `json:"mime,omitempty"`
	Filename string `json:"filename,omitempty"`
}

// HandlePTYControlMessage applies a websocket control message to a PTY-backed tmux session.
func HandlePTYControlMessage(ptySess *PTYSession, raw []byte) error {
	var msg PTYControlMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return err
	}

	switch msg.Type {
	case "resize":
		if msg.Cols == 0 || msg.Rows == 0 {
			return nil
		}
		return ptySess.Resize(msg.Cols, msg.Rows)
	case "paste-image":
		path, err := StorePastedImage(msg.Data, msg.Mime, msg.Filename)
		if err != nil {
			return err
		}
		_, err = ptySess.Write([]byte(path))
		return err
	default:
		return fmt.Errorf("unknown PTY control message type %q", msg.Type)
	}
}

func StorePastedImage(data, mimeType, filename string) (string, error) {
	if strings.TrimSpace(data) == "" {
		return "", fmt.Errorf("missing pasted image data")
	}
	if mimeType != "" && !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		return "", fmt.Errorf("unsupported pasted image MIME type %q", mimeType)
	}

	decodedLen := base64.StdEncoding.DecodedLen(len(data))
	if decodedLen <= 0 {
		return "", fmt.Errorf("invalid pasted image payload")
	}
	if decodedLen > maxPastedImageBytes {
		return "", fmt.Errorf("pasted image exceeds %d byte limit", maxPastedImageBytes)
	}

	imageBytes, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", fmt.Errorf("decode pasted image: %w", err)
	}
	if len(imageBytes) == 0 {
		return "", fmt.Errorf("empty pasted image payload")
	}
	if len(imageBytes) > maxPastedImageBytes {
		return "", fmt.Errorf("pasted image exceeds %d byte limit", maxPastedImageBytes)
	}

	dir := filepath.Join(os.TempDir(), "guppi-paste")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create paste directory: %w", err)
	}

	path := filepath.Join(dir, pastedImageName(mimeType, filename))
	if err := os.WriteFile(path, imageBytes, 0o600); err != nil {
		return "", fmt.Errorf("write pasted image: %w", err)
	}

	return path, nil
}

func pastedImageName(mimeType, filename string) string {
	stamp := time.Now().UTC().Format("20060102-150405")
	return fmt.Sprintf("pasted-%s-%s%s", stamp, randomHex(4), pastedImageExt(mimeType, filename))
}

func pastedImageExt(mimeType, filename string) string {
	switch strings.ToLower(mimeType) {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/bmp":
		return ".bmp"
	case "image/heic":
		return ".heic"
	case "image/heif":
		return ".heif"
	}

	switch ext := strings.ToLower(filepath.Ext(filename)); ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif":
		if ext == ".jpeg" {
			return ".jpg"
		}
		return ext
	}

	return ".png"
}

func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
