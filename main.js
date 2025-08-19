if (!('gpu' in navigator)) {
    alert('WebGPU not supported in this browser.')
    throw new Error('WebGPU not supported')
}
const canvas = document.getElementById('gfx')
const context = canvas.getContext('webgpu')

// 1) device + context
const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format, alphaMode: 'opaque' })

// 2) WGSL: VS consumes:
// - @location(0) position
// - @location(1) color
// These are described in the pipeline's vertex layout later in the code
const shaderWGSL = /* wgsl */ `
struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs(@location(0) inPos: vec2<f32>,
      @location(1) inCol: vec3<f32>) -> VSOut {
    var out: VSOut;
    out.pos = vec4<f32>(inPos, 0.0, 1.0);
    out.color = inCol;
    return out;
}

@fragment
fn fs(@location(0) color: vec3<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(color, 1.0);
}
`
const module = device.createShaderModule({ code: shaderWGSL })

// 3) Vertex data (interleaved: [x,y r,g,b] per vertex)
// prettier-ignore
const verts = new Float32Array([
    // x,   y,    r,   g,   b
     0.0, 0.6,  1.0, 0.2, 0.2, // top   (red-ish)
    -0.6,-0.6,  0.2, 1.0, 0.2, // left  (green-ish)
     0.6,-0.6,  0.2, 0.6, 1.0, // right (blue-ish)
]);
// allocate memory on the GPU
// - VERTEX - you're allowed to bind it with `pass.setVertexBuffer(...)`
// - COPY_DST - you're allowed to copy into it from the CPU with `writeBuffer`
const vertexBuffer = device.createBuffer({
    size: verts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
})
// Upload the bytes from JS into the GPU buffer (asynchronous call)
device.queue.writeBuffer(vertexBuffer, 0, verts)

// 4) Describe the interleaved layout to the pipeline
// (vertex descriptor)
// stride = 5 floats * 4 bytes = 20 bytes per-vertex
// This is also where we specify the @location(n) mappings for our WGSL above
const vertexBuffers = [
    {
        arrayStride: 5 * 4,
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position (x, y)
            { shaderLocation: 1, offset: 2 * 4, format: 'float32x3' }, // color (r, g, b)
        ],
    },
]

// 5) Pipeline with vertex layout
// we pass in our vertex description to the vertex function
const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: vertexBuffers },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
})

// 6) draw loop
function frame() {
    const encoder = device.createCommandEncoder()
    const view = context.getCurrentTexture().createView()

    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view,
                loadOp: 'clear',
                clearValue: { r: 0.06, g: 0.08, b: 0.1, a: 1.0 },
                storeOp: 'store',
            },
        ],
    })

    pass.setPipeline(pipeline)

    // this binds our vertex data to the program/shader
    // slot 0 matches the single layout we declared
    pass.setVertexBuffer(0, vertexBuffer)

    pass.draw(3)
    pass.end()

    device.queue.submit([encoder.finish()])
    requestAnimationFrame(frame)
}
frame()
