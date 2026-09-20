# Insta360 与 DJI Osmo 360 镜头标定调研

更新日期：2026-08-06。

本文记录 Insta360 与 DJI Osmo 360 原始双鱼眼素材的公开标定信息、畸变模型和可复用实现。结论基于厂商公开页面及第三方逆向项目；第三方模型不是厂商正式规范，接入前必须使用真实设备素材验证。

## 结论

| 厂商/设备 | 标定参数来源 | 公开畸变模型 | 当前可用程度 |
| --- | --- | --- | --- |
| Insta360 | 部分机型的文件或 protobuf sidecar | X5 已确认使用扩展 MEI/Unified Camera Model | 可参考，不能跨机型或跨设备硬编码 |
| DJI Osmo 360 | 每个 OSV 的 `djmd` 首样本包含工厂标定 | 四阶鱼眼多项式、镜头外参和径向 LUT | 足以尝试按文件生成拼接映射 |
| DJI Avata 360 | 独立标定文件 | Kannala-Brandt | 算法和 WebGL 实现可参考，参数不适用于 Osmo 360 |

没有找到 DJI 官方公开的 Osmo 360 拼接 SDK 或标定数学规范。Insta360 提供官方桌面 SDK，但需要申请，拼接内核和标定数据没有开源。

## DJI Osmo 360

### OSV 内嵌工厂标定

[PanoForge](https://github.com/Belenos-Toutatis/PanoForge) 是 MIT 许可的 Osmo 360 逆向实现。它从 OSV 的 ISO-BMFF `djmd` 元数据轨道首样本提取：

- 每镜头 `fx`、`fy`
- 光心 `cx`、`cy`
- 4 个畸变系数
- 镜头图像宽高
- 镜头 yaw、pitch
- 每镜头外参四元数
- 两组各 14 个浮点数的径向/拼接 LUT
- 每帧姿态以及约 1 kHz 的 IMU 四元数

相关源码和说明：

- [OSV 标定与 IMU 提取器](https://github.com/Belenos-Toutatis/PanoForge/blob/main/app/core/osv_meta/extract_djmd.py)
- [标定参数到 remap 映射](https://github.com/Belenos-Toutatis/PanoForge/blob/main/app/core/maps.py)
- [`djmd` 结构说明](https://github.com/Belenos-Toutatis/PanoForge/blob/main/tools/NOTES-djmd.md)
- [项目许可](https://github.com/Belenos-Toutatis/PanoForge/blob/main/LICENSE)

该解析器注明它基于 Osmo 360 固件 `10.00.25.29`、protobuf `2.0.8` 逆向。字段位置可能随固件变化，实现时必须验证字段数量、数值范围、镜头数和图像尺寸。

### 示例参数

PanoForge 的测试 fixture 包含一台设备的实际标定。以下数值只能用于理解字段，不能作为通用 Osmo 360 参数：

```text
Lens 0:
fx=1048.4379 fy=1048.3364
cx=1907.8378 cy=1920.9382
dist=[0.0747085, -0.0219875, 0.0174450, -0.0089883]
yaw=-179.9608 deg
pitch=90.2025 deg

Lens 1:
fx=1050.0580 fy=1049.8456
cx=1917.2736 cy=1915.5813
dist=[0.0665691, -0.0136995, 0.0119379, -0.0076864]
yaw=-0.4242 deg
pitch=90.1685 deg
```

每个 OSV 都应读取自己的工厂标定，而不是复用上述参数。

### 社区推导的畸变模型

PanoForge 使用类似 OpenCV fisheye 的奇次多项式：

```text
r(theta) = scale * fx *
           (theta + k1*theta^3 + k2*theta^5 + k3*theta^7 + k4*theta^9)
```

其实现发现多项式在大约 `85 deg` 后不再稳定，因此使用切线线性延伸，并通过 OSV 内置 LUT 对 `theta=90 deg` 附近的半径重新定标。这是经验验证结果，不是 DJI 官方公布的模型。

### 可复用的浏览器实现

[dji-equirect-stitch](https://github.com/yolanother/dji-equirect-stitch) 提供 MIT 许可的 Python 和 Three.js/WebGL 实现，包括：

- Kannala-Brandt 鱼眼模型
- 双镜头内参和相对旋转标定
- 浏览器实时拼接 Shader
- IMU 稳定
- 重叠区最小代价接缝

项目现有标定针对 DJI Avata 360，不适用于 Osmo 360。可以复用投影、Shader 和接缝思路，但必须换成从 Osmo OSV 提取或重新求解的参数。

Kannala-Brandt 模型形式为：

```text
r = f * theta *
    (1 + k1*theta^2 + k2*theta^4 + k3*theta^6 + k4*theta^8)
```

相关链接：

- [项目说明](https://github.com/yolanother/dji-equirect-stitch)
- [浏览器实现目录](https://github.com/yolanother/dji-equirect-stitch/tree/main/js)
- [项目许可](https://github.com/yolanother/dji-equirect-stitch/blob/main/LICENSE)

### 其他 OSV 工具

[osv2mov](https://github.com/yoshihiro0323/osv2mov) 证实 OSV 是 ISO-BMFF 容器，通常包含两个 HEVC 鱼眼视频、AAC 音频以及 `djmd`/`dbgi` 数据轨道。它适合用于检查和无损提取轨道，但本身不完成标定拼接。

## Insta360

### 官方 Desktop MediaSDK

[Insta360 Desktop MediaSDK](https://github.com/Insta360Develop/Desktop-MediaSDK-Cpp) 支持 ONE X、ONE R/RS、ONE RS 1-Inch 360、ONE X2、X3、X4、X5 的 INSP/INSV 图片和视频导出，并提供 Template、Optical Flow、Dynamic、AI 等拼接模式。

限制：

- 最新 SDK 需要在 [Insta360 SDK 申请页面](https://www.insta360.com/sdk/apply)申请。
- 公开仓库主要是接口文档和示例。
- 拼接内核、镜头模型和每台设备的标定参数没有开源。
- 主要支持 Windows 与 Ubuntu x86-64，不是浏览器 JavaScript/WASM SDK。

### Insta360 X5 逆向结果

[insv-stitch](https://github.com/BenjaminHenriksson/insv-stitch) 是 MIT 许可的 X5 逆向拼接项目。它确认 X5 的 `.insv.pb` protobuf sidecar 包含扩展标定字符串，包括：

- 每镜头内参和外参
- MEI/Unified Camera Model 参数 `xi=2.0`
- 每镜头 yaw、pitch、roll
- 4 个径向畸变系数
- 2 个切向畸变系数
- 4 个 thin-prism 系数
- 其他扩展系数，共约 13 个畸变参数

MEI 投影的核心形式是：

```text
Xs = X / norm(X,Y,Z)
Ys = Y / norm(X,Y,Z)
Zs = Z / norm(X,Y,Z)

x = Xs / (Zs + xi)
y = Ys / (Zs + xi)
```

之后再应用径向、切向和 thin-prism 畸变。

相关链接：

- [项目主页](https://github.com/BenjaminHenriksson/insv-stitch)
- [完整流水线和 MEI 模型说明](https://github.com/BenjaminHenriksson/insv-stitch/blob/main/PIPELINE.md)
- [逆向记录](https://github.com/BenjaminHenriksson/insv-stitch/blob/main/old/FINDINGS.md)
- [项目许可](https://github.com/BenjaminHenriksson/insv-stitch/blob/main/LICENSE)

这些结论只对项目验证过的 X5 文件成立。ONE RS、X3、X4 可能使用不同容器布局、sidecar 和模型参数，不能直接套用 X5 的字段位置或 `xi`。

### 其他参考项目

- [insvdump](https://github.com/ke4ukz/insvdump)：解析 INSV 中的 INFO、GYRO、GPS、EXPOSURE 等 protobuf 元数据。
- [telemetry-parser](https://github.com/AdrianEddy/telemetry-parser)：支持 Insta360 遥测和部分镜头配置，可作为元数据字段参考。
- [360cams-PTGui-Templates](https://github.com/andreasbrett/360cams-PTGui-Templates)：多个 360 相机的 PTGui 模板，适合人工验证固定机型几何，但不能替代每台设备的工厂标定。

## 对 filens 的建议

### 优先实现 Osmo 360

Osmo OSV 已内嵌较完整的工厂标定，建议按以下顺序实现：

1. 在前端 Rust WASM conversion core 中解析 ISO-BMFF sample table 和首个完整 `djmd` 样本。
2. 输出两镜头内参、外参、畸变系数、LUT 和经过验证的 IMU 数据。
3. 在 panorama WebGL Shader 中把等距柱状输出方向反投影到两个鱼眼纹理。
4. 使用 LUT 校正大视场边缘，不能只根据视频是 `2:1` 就认为它已拼接。
5. 远景可先使用标定权重羽化；近景视差应升级为动态最小代价接缝，避免简单混合产生双影。
6. `.LRF` 只作为浏览器可解码的低清输入，不再把其现成画面视为准确拼接结果。

遵循项目架构边界，OSV/INSV 解析和标定逻辑应位于前端 WASM core；Go 后端只能负责调用、临时文件和错误映射。

### Insta360 按机型处理

1. 优先识别相机型号、元数据版本以及 sidecar 是否存在。
2. X5 可以参考 `insv-stitch` 的 protobuf 和 MEI 实现。
3. ONE RS/X3/X4 必须先用真实文件确认字段和模型，不能回退到 X5 固定参数。
4. 官方 Desktop MediaSDK 可以作为离线参考输出，但其许可、平台和闭源实现不适合直接嵌入浏览器。

## 风险

- 第三方字段映射可能随固件更新而变化。
- 工厂标定可能按设备序列号不同，fixture 参数不可硬编码。
- 静态标定只能解决几何畸变；近物体仍有镜头基线造成的视差。
- 光流或简单宽区域混合可能产生重影，不能替代动态接缝。
- IMU 到相机的旋转可能存在设备装配差异，需要真实硬件校验。
- 厂商文件格式、SDK 和逆向代码的许可需要在发布前单独审查。
