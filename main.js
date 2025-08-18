// Basic feature check
if (!('gpu' in navigator)) {
    alert('WebGPU not supported in this browser.')
    throw new Error('WebGPU not supported')
}

const canvas = document.getElementById('gfx')
const context = canvas.getContext('webgpu')

// 1) adapter + device
// adapter: which GPU am I talking to
// device: your connection to the GPU through WebGPU used to create
//   resources and submit work
// (note: in practice you only request these once and pass them around your app)
const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()

// 2) configure swapchain
// WebGPU doesn't assume anything, you must configure the html context to tell it:
// - Which GPU device it should use
// - What texture format the canvas expects
// - How alpha blending with the page background should work
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format, alphaMode: 'opaque' })

// 3) WGSL shader (procedural triangle via vertex_index)
const shaderWGSL = /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>( 0.0, 0.6),
        vec2<f32>(-0.6,-0.6),
        vec2<f32>( 0.6,-0.6)
    );
    return vec4<f32>(pos[i], 0.0, 1.0);
}

@fragment
fn fs() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 0.5, 0.2, 1.0); // orange
}
`
// parses WGSL and runs checks (not fully compiled until pipeline use)
const module = device.createShaderModule({ code: shaderWGSL })

// 4) pipeline
// An immutable recipe that bakes together shader + state:
// - your shaders (vertex + fragment)
// - the fixed-function state (topology, depth/stencil, blending, msaa, vertex layout)
// - the binding layout (uniforms, textures, samplers)
// You create it once, then reuse it every frame
const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
})

// 5) draw loop
function frame() {
    // collects command you want the GPU to run
    const encoder = device.createCommandEncoder()
    // The canvas context holds a swap chain of textures
    // We are asking for the next texture to render into here
    const view = context.getCurrentTexture().createView()

    // Render pass describes the textures and resources bound to draw one frame
    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view, // texture target from canvas context
                loadOp: 'clear', // op before drawing
                clearValue: { r: 0.06, g: 0.08, b: 0.1, a: 1.0 },
                storeOp: 'store', // op after drawing
            },
        ],
    })

    pass.setPipeline(pipeline)
    pass.draw(3) // invoke shader 3 times each with an incrementing `vertex_index`
    pass.end() // done describing our render pass

    // Put our command buffer into the GPU's command queue
    // GPU commands are executed asynchronously
    device.queue.submit([encoder.finish()])
    requestAnimationFrame(frame)
}
frame()
