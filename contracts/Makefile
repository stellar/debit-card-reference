default: build

test: build
	cargo test --all-features -- --nocapture

build:
	cargo build -p issuer --target wasm32v1-none --release

fmt:
	cargo fmt --all

clippy:
	cargo clippy --workspace --all-targets --all-features -- -D warnings -D clippy::all

clean:
	cargo clean
