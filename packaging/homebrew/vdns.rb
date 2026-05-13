class Vdns < Formula
  desc "VerusID-native DNS-compatible local resolver and web gateway"
  homepage "https://github.com/devdudeio/vdns"
  url "https://github.com/devdudeio/vdns/releases/download/v0.2.1/vdns-0.2.1.tar.gz"
  sha256 "d5c8498b0b0db8ed431f7c45be37f718c97e4c58ca5c03eb39a5c45f104773d9"
  license "MIT"

  depends_on "node"
  depends_on "openssl@3"

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/vdns" => "vdns"
  end

  def caveats
    <<~EOS
      vDNS is installed but no services were started.

      Run the guided local setup:
        vdns bootstrap

      Check the stack:
        vdns status
        vdns doctor --strict --https

      Logs and runtime state default to:
        ~/.vdns

      To uninstall services before removing the formula:
        vdns stop
        vdns uninstall
        brew uninstall vdns
    EOS
  end

  test do
    system "#{bin}/vdns", "--version"
    system "#{bin}/vdns", "help"
    system "#{bin}/vdns", "paths"
  end
end
