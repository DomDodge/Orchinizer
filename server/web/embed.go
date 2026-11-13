// Package web embeds the TV page. The Docker build copies the /tv build
// output into static/ over the placeholder.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:static
var files embed.FS

// Static is the TV page's files, rooted at static/.
func Static() fs.FS {
	sub, err := fs.Sub(files, "static")
	if err != nil {
		panic(err)
	}
	return sub
}
