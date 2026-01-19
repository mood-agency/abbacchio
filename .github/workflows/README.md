# GitHub Actions Workflows

Este directorio contiene los workflows de CI/CD para Abbacchio.

## Un solo comando para publicar todo

```bash
# 1. Actualiza las versiones en package.json (si hay cambios en los paquetes npm)
# 2. Commit los cambios
git add .
git commit -m "chore: release v0.2.0"

# 3. Crea y pushea el tag
git tag v0.2.0
git push origin master --tags

# Esto dispara AMBOS workflows en paralelo:
# - Release Desktop App (Windows, macOS, Linux)
# - Publish npm Packages (@abbacchio/transport, @abbacchio/browser-transport)
```

## Workflows

| Workflow | Archivo | Trigger | Qué hace |
|----------|---------|---------|----------|
| **Release Desktop** | `release.yml` | Tag `v*` | Compila Tauri para Win/Mac/Linux → GitHub Releases |
| **Publish npm** | `npm-publish.yml` | Tag `v*` | Publica paquetes npm (si la versión no existe) |

## Diagrama

```
git tag v0.2.0 && git push origin --tags
                    │
     ┌──────────────┴──────────────┐
     ▼                             ▼
Release Desktop App         Publish npm Packages
     │                             │
     ▼                             ▼
GitHub Releases              npmjs.com
(exe, dmg, AppImage)         (@abbacchio/*)
```

## Configuración requerida

### Secretos (Settings → Secrets and variables → Actions)

| Secreto | Requerido | Descripción |
|---------|-----------|-------------|
| `NPM_TOKEN` | **Sí** | Token de npm para publicar paquetes |
| `TAURI_SIGNING_PRIVATE_KEY` | No | Clave para firmar actualizaciones de Tauri |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | No | Password de la clave |

### Permisos (Settings → Actions → General)

- **Workflow permissions**: "Read and write permissions"

## Flujo de trabajo recomendado

### Nuevo release (todo junto)

```bash
# 1. Asegúrate de estar en master actualizado
git checkout master
git pull

# 2. Si hay cambios en los paquetes npm, actualiza las versiones
# packages/transport/package.json → "version": "0.2.0"
# packages/browser-transport/package.json → "version": "0.2.0"

# 3. Commit y tag
git add .
git commit -m "chore: release v0.2.0"
git tag v0.2.0
git push origin master --tags
```

### Solo desktop (sin cambios en npm)

Si no actualizaste las versiones de los paquetes npm, el workflow de npm detectará que las versiones ya existen y las saltará automáticamente.

```bash
git tag v0.2.1
git push origin v0.2.1
# Desktop se compila, npm se salta (versiones ya existen)
```

### Release manual desde GitHub UI

1. Ve a **Actions**
2. Selecciona el workflow que quieras
3. Click **"Run workflow"**

## Artefactos generados

### Desktop (GitHub Releases)

| Plataforma | Archivos |
|------------|----------|
| Windows | `Abbacchio_x.x.x_x64-setup.exe`, `.msi` |
| macOS Intel | `Abbacchio_x.x.x_x64.dmg` |
| macOS Apple Silicon | `Abbacchio_x.x.x_aarch64.dmg` |
| Linux | `Abbacchio_x.x.x_amd64.AppImage`, `.deb` |

### npm Packages

| Paquete | Descripción |
|---------|-------------|
| `@abbacchio/transport` | Transports para Pino, Winston, Bunyan |
| `@abbacchio/browser-transport` | Cliente de logging para browser/React |

## Convenciones de versión

| Tag | Tipo | Ejemplo |
|-----|------|---------|
| `v1.0.0` | Stable | Release de producción |
| `v1.0.0-beta` | Pre-release | Marcado como prerelease en GitHub |
| `v1.0.0-alpha.1` | Alpha | Para testing interno |

## Tiempos estimados

| Workflow | Tiempo |
|----------|--------|
| Release Desktop (primera vez) | ~10-15 min |
| Release Desktop (con cache) | ~5-8 min |
| Publish npm | ~1-2 min |

## Troubleshooting

### El workflow no se ejecuta

- Verifica que el tag tenga formato `v*` (ejemplo: `v0.2.0`)
- Asegúrate de pushear el tag: `git push origin v0.2.0`

### Error npm 403 Forbidden

- Verifica que `NPM_TOKEN` esté configurado en Secrets
- El token debe tener permisos de escritura
- Si usas 2FA, el token debe ser tipo "Automation" o "Granular" con bypass

### Build de Tauri falla

- Revisa los logs en Actions
- Verifica que `pnpm-lock.yaml` esté actualizado

## Links útiles

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Tauri GitHub Action](https://github.com/tauri-apps/tauri-action)
- [npm Publishing](https://docs.npmjs.com/cli/v10/commands/npm-publish)
