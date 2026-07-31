# Barwarden icon provenance

`barwarden-b4.1-source.png` is the approved B4.1 master artwork. The production
application and status-item assets are generated from that pinned source by
`scripts/build-barwarden-icons.sh`; they are not copied from the upstream
Bitwarden client.

Current SHA-256:

- `barwarden-b4.1-source.png`: `2f29c0bf2faf3f19b51ad7463193dc01a4d8bc267e1a39c5d8b66e44038b8138`
- `icon.png`: `90a7d53d654f3c54f6f45ef3f493e058d0bca906827f81905b56e06136954b0e`
- `icon.icns`: `853661e0b6faa1e62e53beebf0ab0bef6c3d87be63f56ae945a83591beab3fc9`
- `tray-template@2x.png`: `0d0ac5a2e1ca0ebc54a51cc97f3ea07158f74c1e3f4f3d01dd344c8c49ce1ea8`

Run `npm run build:icons` to regenerate the production files, then
`npm run test:icons` to validate the approved source, transparent application
icon, exact ICNS representation inventory, monochrome tray template, and
transactional publication behavior.
