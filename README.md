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
