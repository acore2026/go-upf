package userspace

import (
	"os"
	"unsafe"

	"golang.org/x/sys/unix"
)

type tunDevice interface {
	Read([]byte) (int, error)
	Write([]byte) (int, error)
	Close() error
	Name() string
	SetMTU(int) error
}

type tunFile struct {
	file *os.File
	name string
}

func openTUN(name string) (tunDevice, error) {
	fd, err := unix.Open("/dev/net/tun", unix.O_RDWR, 0)
	if err != nil {
		return nil, err
	}
	ifr := make([]byte, unix.IFNAMSIZ+64)
	copy(ifr[:unix.IFNAMSIZ], name)
	*(*uint16)(unsafe.Pointer(&ifr[unix.IFNAMSIZ])) = unix.IFF_TUN | unix.IFF_NO_PI
	if _, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), uintptr(unix.TUNSETIFF), uintptr(unsafe.Pointer(&ifr[0]))); errno != 0 {
		_ = unix.Close(fd)
		return nil, errno
	}

	actualName := string(ifr[:unix.IFNAMSIZ])
	for idx, c := range actualName {
		if c == 0 {
			actualName = actualName[:idx]
			break
		}
	}
	return &tunFile{
		file: os.NewFile(uintptr(fd), "/dev/net/tun"),
		name: actualName,
	}, nil
}

func (t *tunFile) Read(p []byte) (int, error) {
	return t.file.Read(p)
}

func (t *tunFile) Write(p []byte) (int, error) {
	return t.file.Write(p)
}

func (t *tunFile) Close() error {
	return t.file.Close()
}

func (t *tunFile) Name() string {
	return t.name
}

func (t *tunFile) SetMTU(mtu int) error {
	fd, err := unix.Socket(unix.AF_INET, unix.SOCK_DGRAM, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)

	ifr := make([]byte, unix.IFNAMSIZ+64)
	copy(ifr[:unix.IFNAMSIZ], t.name)
	*(*int32)(unsafe.Pointer(&ifr[unix.IFNAMSIZ])) = int32(mtu)
	if _, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), uintptr(unix.SIOCSIFMTU), uintptr(unsafe.Pointer(&ifr[0]))); errno != 0 {
		return errno
	}
	return nil
}
