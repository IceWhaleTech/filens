//go:build windows

package main

import (
	"syscall"
	"unsafe"

	"github.com/ebitengine/purego"
)

// The pinned Photos wrapper uses dlopen on Unix. Windows keeps the same
// NCNN C ABI and symbol registration, with the operating system's DLL loader.
func nativeDlopen(path string) (uintptr, error) {
	handle, err := syscall.LoadLibrary(path)
	return uintptr(handle), err
}

// NCNN exposes UTF-16 file APIs on Windows. Use them for model paths so npm
// prefixes and user directories containing Chinese characters work as well.
func registerWindowsNativeSymbol(target interface{}, handle uintptr, symbol string) {
	if symbol != "ncnn_net_load_param" && symbol != "ncnn_net_load_model" {
		purego.RegisterLibFunc(target, handle, symbol)
		return
	}
	var wideCall func(uintptr, *uint16) int32
	purego.RegisterLibFunc(&wideCall, handle, symbol+"_w")
	*target.(*func(uintptr, *byte) int32) = func(net uintptr, filename *byte) int32 {
		if filename == nil { return -1 }
		length := 0
		for *(*byte)(unsafe.Add(unsafe.Pointer(filename), length)) != 0 { length++ }
		wide, err := syscall.UTF16PtrFromString(unsafe.String(filename, length))
		if err != nil { return -1 }
		return wideCall(net, wide)
	}
}
