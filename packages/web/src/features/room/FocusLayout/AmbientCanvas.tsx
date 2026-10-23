import { useEffect, useRef, type RefObject } from 'react';

const FPS = 10;

/**
 * A tiny canvas behind the focus view, stretched and blurred by CSS, that keeps blending in
 * frames of the video so its colours spill around it. Each frame is drawn at low alpha over the
 * last, which makes the glow trail behind the picture.
 */
export function AmbientCanvas({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        let raf: number;
        let lastDraw = 0;
        const draw = (now: number) => {
            raf = requestAnimationFrame(draw);
            if (now - lastDraw < 1000 / FPS) return;
            lastDraw = now;
            const video = videoRef.current;
            if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
            ctx.globalAlpha = 0.35;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
        };
        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [videoRef]);

    return <canvas ref={canvasRef} width={64} height={36} className="fl-ambient-canvas" />;
}
