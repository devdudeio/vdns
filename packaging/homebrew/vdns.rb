class Vdns < Formula
  desc "VerusID-native DNS-compatible local resolver and web gateway"
  homepage "https://github.com/devdudeio/vdns"
  url "https://github.com/devdudeio/vdns/releases/download/v0.1.6/vdns-0.1.6.tar.gz"
  sha256 "405cedc00ffb6ac2fea075fc3541bc45a3ce857c41535cd5729dd5df6a94b8a3"
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

      Configure RPC credentials:
        vdns setup

      Install and start the macOS launchd services explicitly:
        vdns install
        vdns start

      Check the stack:
        vdns status
        vdns demo

      Optional local HTTPS for https://*.vrsc requires a per-device CA:
        vdns https init-ca
        vdns https install-ca
        set VDNS_HTTPS_ENABLED=true in ~/.vdns/.env.local
        vdns restart

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
