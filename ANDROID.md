# Washos Packer - Android APK

Guía completa para compilar Washos Packer como aplicación Android usando Capacitor.

## 🚀 Compilación Rápida

### Opción 1: GitHub Actions (Recomendado)
1. Ve a **Actions** → **Build Android APK**
2. Click **"Run workflow"**
3. Selecciona tipo de build: `debug`, `release`, o `both`
4. Descarga el APK de los artifacts

### Opción 2: Línea de comandos
```bash
git clone https://github.com/jereidk/FunkyPacker.git
cd FunkyPacker
npm install
npm run build-apk
```
APK en: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📋 Requisitos

| Requisito | Versión mínima |
|-----------|----------------|
| Node.js | 14+ |
| Java JDK | 11+ (17 recomendado) |
| Android SDK | API 22+ |
| Android Gradle Plugin | 8.x |

### Variables de entorno
```bash
export JAVA_HOME=/ruta/al/jdk
export ANDROID_HOME=/ruta/al/sdk
```

---

## 🔧 Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm run build-android` | Compila la app para Android |
| `npm run sync-android` | Sincroniza cambios web → Android |
| `npm run copy-android-assets` | Build + sync en un comando |
| `npm run build-apk` | Compila APK debug |
| `npm run build-release-apk` | Compila APK release |
| `npm run open-android` | Abre en Android Studio |

---

## ✅ Funcionalidades Implementadas

### Módulos Android
- **FileSystem.js**: Lectura de imágenes desde dispositivo, guardado de proyectos
- **Downloader.js**: Exportación ZIP con opción de compartir
- **Controller.js**: StatusBar, SplashScreen, manejo del botón de atrás
- **Project.js**: Gestión de proyectos
- **Tinifyer.js**: Compresión de imágenes via TinyPNG API

### Características Móviles
- ✅ Selección de imágenes múltiples
- ✅ Exportación a ZIP con compartir nativo
- ✅ UI optimizada para touch (44px+ targets)
- ✅ Botón de atrás de Android funcional
- ✅ Tema oscuro consistente
- ✅ Safe areas para notch/pantalla completa
- ✅ Soporte landscape y portrait

### Permisos Android
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.VIBRATE" />
```

---

## 🛠️ Solución de Problemas

### Error: SDK location not found
```bash
export ANDROID_HOME=~/Android/Sdk
# Verificar con:
ls $ANDROID_HOME
```

### Error: Gradle build failed
```bash
cd android
./gradlew clean
./gradlew assembleDebug --info
```

### Error: Java version mismatch
```bash
java -version  # Debe ser 11 o 17
```

### Error: Plugin not found
```bash
npx cap sync android
```

---

## 📱 Distribución del APK

### Debug APK
Directamente instalable en dispositivos para pruebas.

### Release APK
1. Generar keystore:
```bash
keytool -genkey -v -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

2. Configurar firma en `android/app/build.gradle`

3. Compilar:
```bash
npm run build-release-apk
```

---

## 📁 Estructura de Archivos

```
src/client/platform/android/
├── Controller.js     # Controlador móvil (StatusBar, Splash, Back button)
├── Downloader.js      # Exportación y compartir
├── FileSystem.js      # Acceso a archivos y proyectos
├── Project.js         # Gestión de proyectos
├── Tinifyer.js        # Compresión TinyPNG
└── index.js           # Exports del módulo

android/               # Proyecto Android nativo
├── app/
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── assets/public/  # Web assets compilados
├── build.gradle
└── settings.gradle
```

---

## 🔄 Actualizar después de cambios

Si modificas código fuente:
```bash
npm run build-android
npx cap sync android
# Luego compilar APK
```

---

## 📊 Compatibilidad Probada

| Componente | Estado |
|------------|--------|
| Compilación webpack | ✅ OK |
| Sync Capacitor | ✅ OK |
| Plugin Filesystem | ✅ OK |
| Plugin Share | ✅ OK |
| Plugin StatusBar | ✅ OK |
| Plugin SplashScreen | ✅ OK |
| Plugin App (back button) | ✅ OK |
| JSZip (export ZIP) | ✅ OK |