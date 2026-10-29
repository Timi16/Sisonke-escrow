.PHONY: build fixture test test-fast soak fmt lint check multisig-admin deploy upgrade-propose upgrade-execute upgrade-cancel upgrade-demo bindings e2e-setup e2e web-dev web-check web-e2e clean

FIXTURE_WASM = target/wasm32v1-none/release/sisonke_upgrade_fixture.wasm
FIXTURE_COPY = contracts/sisonke-escrow/testdata/upgrade_fixture.wasm

# The deployable contract.
build:
	stellar contract build --package sisonke-escrow

# Rebuilds the test-only v2 and refreshes the committed copy the upgrade
# tests import. Run after changing contracts/upgrade-fixture.
fixture:
	stellar contract build --package sisonke-upgrade-fixture
	cp $(FIXTURE_WASM) $(FIXTURE_COPY)

# Builds first so the wasm tests run against current source.
test: build
	cargo test -- --include-ignored

# Everything except the compiled-wasm tests.
test-fast:
	cargo test

# Longer random run of the model test.
soak:
	MODEL_SEEDS=300 cargo test model

fmt:
	cargo fmt --all

lint:
	cargo fmt --all -- --check
	cargo clippy --all-targets -- -D warnings

check: lint test

# Native 2-of-3 multisig admin account (deploy creates it on Testnet anyway).
multisig-admin:
	./scripts/multisig-admin.sh

deploy:
	./scripts/deploy.sh

# Timelocked upgrade: propose, wait upgrade_delay(), execute (MIGRATE=1 to migrate).
upgrade-propose:
	./scripts/upgrade.sh propose

upgrade-execute:
	./scripts/upgrade.sh execute

upgrade-cancel:
	./scripts/upgrade.sh cancel

# Testnet upgrade proof on a separate, throwaway instance (docs/UPGRADES.md).
upgrade-demo:
	./scripts/upgrade-demo.sh

bindings:
	./scripts/bindings.sh

# Testnet run order: make deploy → make e2e-setup → make e2e → make upgrade-demo
# (deploy creates the multisig admin itself; make multisig-admin is optional)
# (e2e-setup also works before deploy).
e2e-setup:
	cd scripts && npm ci && node e2e.ts setup

e2e:
	cd scripts && node e2e.ts

# Web app (web/README.md).
web-dev:
	cd web && pnpm install && pnpm dev

web-check:
	cd web && pnpm install --frozen-lockfile && pnpm check

web-e2e:
	cd web && pnpm e2e

clean:
	cargo clean
