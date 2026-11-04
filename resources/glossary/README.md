# Community glossary

This folder is packaged to `resources/glossary` in the installed launcher.

- `community-glossary.tsv.gz`: read-only `source<TAB>target` glossary, 390,882 entries.
- `community-glossary.meta.json`: entry count and source metadata used by the UI.
- `NOTICE.md` / `LICENSE-CC-BY-NC-SA-4.0.txt`: attribution and license.

Source: [CFPAOrg/Minecraft-Mod-Language-Package](https://github.com/CFPAOrg/Minecraft-Mod-Language-Package),
commit `6a5e51509159f9c12d5727808f7b1e42c4e05200`, licensed **CC BY-NC-SA 4.0**.
The launcher uses this data non-commercially with attribution and does not claim
ownership of the community translations.

Regenerate from a CFPA checkout:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/CFPAOrg/Minecraft-Mod-Language-Package.git cfpa
git -C cfpa sparse-checkout set projects/assets
npm run glossary:build -- --source ./cfpa --out resources/glossary --commit <commit-sha>
```

Or from a repository zip without extracting it:

```bash
npm run glossary:build -- --zip ./Minecraft-Mod-Language-Package-main.zip --out resources/glossary --commit <commit-sha>
```
