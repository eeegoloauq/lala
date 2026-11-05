/**
 * A screen share for a simulated participant: a canvas drawn in the page and captured as a
 * MediaStream, so it plays through the same video, focus view and ambient glow as a real one.
 */
export function fakeScreen(label: string, hue: number): { stream: MediaStream; stop: () => void } {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d')!;
    // Line lengths of the "document" in the window, fixed per screen.
    const lines = Array.from({ length: 14 }, () => 0.25 + Math.random() * 0.6);
    const start = performance.now();

    const draw = () => {
        const t = (performance.now() - start) / 1000;
        const { width: w, height: h } = canvas;
        const bg = ctx.createLinearGradient(0, 0, w, h);
        bg.addColorStop(0, `hsl(${hue} 45% 18%)`);
        bg.addColorStop(1, `hsl(${(hue + 40) % 360} 50% 10%)`);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // A window with a title bar and a page whose last line is being typed.
        const [x, y, ww, wh] = [140, 90, w - 280, h - 180];
        ctx.fillStyle = 'hsl(230 15% 13%)';
        ctx.beginPath();
        ctx.roundRect(x, y, ww, wh, 14);
        ctx.fill();
        ctx.fillStyle = 'hsl(230 12% 19%)';
        ctx.beginPath();
        ctx.roundRect(x, y, ww, 44, [14, 14, 0, 0]);
        ctx.fill();
        ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x + 26 + i * 22, y + 22, 7, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.fillStyle = 'hsl(230 10% 75%)';
        ctx.font = '600 18px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + ww / 2, y + 28);

        const typed = (t * 0.12) % 1;
        lines.forEach((len, i) => {
            const isLast = i === lines.length - 1;
            const lineW = (ww - 120) * len * (isLast ? typed : 1);
            ctx.fillStyle = i % 5 === 0 ? `hsl(${hue} 70% 65%)` : 'hsl(230 10% 40%)';
            ctx.beginPath();
            ctx.roundRect(x + 60 + (i % 3 === 1 ? 32 : 0), y + 80 + i * 32, lineW, 12, 6);
            ctx.fill();
        });

        // The presenter's pointer, drifting around.
        const px = x + ww / 2 + Math.sin(t * 0.7) * ww * 0.35;
        const py = y + wh / 2 + Math.sin(t * 1.1) * wh * 0.3;
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + 22, py + 16);
        ctx.lineTo(px + 9, py + 18);
        ctx.lineTo(px + 2, py + 30);
        ctx.closePath();
        ctx.fill();
    };

    draw();
    // A timer, not requestAnimationFrame: a capture must keep getting frames in a background tab.
    const timer = setInterval(draw, 1000 / 15);
    const stream = canvas.captureStream(15);
    return {
        stream,
        stop: () => {
            clearInterval(timer);
            stream.getTracks().forEach(track => track.stop());
        },
    };
}
