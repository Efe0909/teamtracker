{
  description = "EkipTakip — Rust API + React on yuz: paket + NixOS modulu";

  # ~/nix bunu `inputs.teamtracker.inputs.nixpkgs.follows = "nixpkgs"` ile
  # kendi nixpkgs'ine baglar.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      eachSystem = f: lib.genAttrs [ "aarch64-linux" "x86_64-linux" "aarch64-darwin" ]
        (s: f nixpkgs.legacyPackages.${s});

      # HEDEF MAKINE DERLEMEZ (VM de Pi de). Ikili + on yuz Mac'te derlenip
      # GitHub release'e yuklenir; `backend/tools/release.sh` url+hash'i
      # deploy/release.nix'e yazar, burasi fetchurl ile ceker. Statik musl
      # ikili: autoPatchelf gerekmez. Kaynaktan Nix derlemesi BILEREK yok.
      #
      # Tarball: bin/ekiptakip + share/ekiptakip/web (frontend/dist).
      prebuilt = pkgs:
        let r = import ./deploy/release.nix; in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "ekiptakip";
          version = r.tag;
          src = pkgs.fetchurl { inherit (r) url hash; };
          sourceRoot = "."; # tarball'in tek ust dizini yok
          dontBuild = true;
          installPhase = "mkdir -p $out && cp -r bin share $out/";
          meta.mainProgram = "ekiptakip";
        };
    in
    {
      # Yalniz ilk release'ten SONRA (deploy/release.nix var) ve yalniz
      # aarch64-linux: ikili o hedefe derleniyor.
      packages = lib.optionalAttrs (builtins.pathExists ./deploy/release.nix) {
        aarch64-linux.default = prebuilt nixpkgs.legacyPackages.aarch64-linux;
      };

      # Mac'te derleme araclari: `nix develop`.
      devShells = eachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            cargo rustc clippy rustfmt rust-analyzer
            zig cargo-zigbuild # cross: aarch64-unknown-linux-musl
            nodejs
          ];
        };
      });

      nixosModules.default = import ./deploy/module.nix;
    };
}
