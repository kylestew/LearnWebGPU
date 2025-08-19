# Learn WebGPU (in parts)

Each segment of learning is tagged (i.e. `step1`), see tags to browse that step.

### Running Server

```bash
npx live-server
```

## Step 1

- Request an adapter and device from WebGPU.
- Configure a canvas context with the preferred texture format.
- Write a minimal WGSL vertex shader using vertex_index to produce positions without buffers.
- Write a fragment shader that outputs a solid color.
- Create a render pipeline and draw inside a render pass.
- Core rendering flow = Device → Pipeline → Pass → Submit.

## Step 2

- Use a GPU vertex buffer for per-vertex data instead of generating positions in the shader.
- Interleave attributes: position (`@location(0) vec2<f32>`) and color (`@location(1) vec3<f32>`).
- Describe the layout via `vertex.buffers` using `arrayStride` and `attributes` offsets.
- Pass the color from vertex to fragment and output it in the fragment shader.
- Bind the vertex buffer with `pass.setVertexBuffer(0, vertexBuffer)` and draw a colored triangle.

![Step 2 — Vertex Buffer + Color](images/step2.png)
