# Washos Packer

**Smart Texture Packer for Friday Night Funkin' Modding**

![logo](https://raw.githubusercontent.com/odrick/free-tex-packer/master/electron/build/icons/96x96.png)

Washos Packer es una herramienta web de empaquetado de texturas inteligente, diseñada específicamente para el modding de Friday Night Funkin'. Basado en [Funkin-Packer](https://github.com/NeeEoo/Funkin-Packer) con características avanzadas de optimización automática.

## 🎯 Características Principales

### Smart Size Solver
El sistema más inteligente de empaquetado para sprites de FNF:

- **Cálculo Paralelo con Web Workers**: Usa `navigator.hardwareConcurrency` para paralelizar el cálculo de dimensiones óptimas
- **Límite de 4096px**: Protege GPUs de gama baja en Android (target principal de FNF)
- **Eficiencia en Tiempo Real**: Muestra el porcentaje de uso del atlas

### Selector de Modo (3 Estados)

| Modo | Descripción |
|------|-------------|
| **SCALE** | Calcula dimensiones óptimas. Si excede 4096px, escala proporcionalmente todos los sprites |
| **AUTO** | Decide automáticamente entre SCALE y MULTI-ATLAS. Si eficiencia SCALE < 70%, usa MULTI-ATLAS |
| **MULTI-ATLAS** | Distribuye sprites en múltiples páginas optimizadas individualmente |

### Modo Manual
Toggle para desactivar el solver automático y configurar Width/Height manualmente, manteniendo compatibilidad con el comportamiento original.

## ⚙️ Configuración por Defecto (Optimizada para FNF)

| Opción | Valor |
|--------|-------|
| Trim | ✅ Activado |
| Padding | 0px |
| Exporter | Sparrow Starling XML |
| Allow Rotation | ❌ Desactivado |

## 🚀 Despliegue

### Desarrollo Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo (localhost:4000)
npm start
```

### Build para Producción

```bash
# Generar archivos estáticos en dist/web/
npm run build
```

### Desplegar en GitHub Pages

1. Haz commit del build en tu repositorio:
   ```bash
   git add dist/
   git commit -m "Build production files"
   ```

2. Habilita GitHub Pages en el repositorio:
   - Ve a **Settings > Pages**
   - Source: Deploy from a branch
   - Branch: `gh-pages` (o la rama donde esté el build)

3. Los archivos en `dist/web/` se servirán públicamente desde:
   ```
   https://[username].github.io/[repo-name]/
   ```

## 📁 Estructura del Proyecto

```
FunkyPacker/
├── src/
│   └── client/
│       ├── ui/              # Componentes React
│       ├── utils/           # Utilidades (incluye SmartSizeSolver)
│       ├── workers/         # Web Workers para cálculo paralelo
│       ├── packers/         # Algoritmos de empaquetado
│       ├── exporters/       # Formatos de exportación
│       └── platform/        # API específica por plataforma
├── dist/
│   └── web/                 # Archivos estáticos para GitHub Pages
├── webpack.config.js        # Configuración de build
└── package.json             # Dependencias y scripts
```

## 🎨 Formatos de Exportación Soportados

- **Sparrow Starling XML** (default)
- JSON
- CSS
- Y otros del proyecto original

## 🔧 Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm start` | Inicia webpack-dev-server en localhost:4000 |
| `npm run build` | Genera build de producción |
| `npm run build-web` | Build específico para web (genera dist/web/) |

## 📝 Notas Técnicas

- **100% Client-Side**: No requiere backend
- **Web Workers**: Cálculos paralelos sin bloquear la UI
- **Compatibilidad**: No se modifica código Electron, Android/Capacitor, ni GitHub Actions

## 🤝 Contribuir

1. Fork el repositorio
2. Crea una rama para tu feature (`git checkout -b feature/nueva-feature`)
3. Commit tus cambios (`git commit -m 'Agregar nueva feature'`)
4. Push a la rama (`git push origin feature/nueva-feature`)
5. Abre un Pull Request

## 📜 Licencia

MIT License - Ver [LICENSE.md](./LICENSE.md)

## 🙏 Créditos

- Original: [Funkin-Packer](https://github.com/NeeEoo/Funkin-Packer) por Ne_Eo
- Basado en: [Free-Tex-Packer](https://github.com/odrick/free-tex-packer) por odrick
- Contributors del proyecto original

---

**Washos Packer** - Smart packing for FNF modding 🎵
