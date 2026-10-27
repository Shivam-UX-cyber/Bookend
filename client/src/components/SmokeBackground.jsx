import React, { useEffect, useRef } from 'react';

/**
 * SmokeBackground Component
 * Renders an authentic, visible, cinematic smoky animation effect using
 * a lightweight GPU-accelerated HTML5 Canvas particle simulation paired with
 * layered CSS ambient mist.
 *
 * Designed specifically for the Obsidian Monochrome theme:
 * - High-visibility soft silver & misty blue billowing smoke clouds.
 * - Fluid curling & rising physics (expansion, drift, rotation, fade-out).
 * - Pauses automatically when tab is hidden to save CPU/GPU.
 * - Zero click interference (pointer-events: none, z-index: 0).
 */
export const SmokeBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Create an offscreen canvas for a high-performance pre-rendered soft smoke puff sprite
    const spriteSize = 256;
    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = spriteSize;
    spriteCanvas.height = spriteSize;
    const sCtx = spriteCanvas.getContext('2d');

    if (sCtx) {
      const grad = sCtx.createRadialGradient(
        spriteSize / 2,
        spriteSize / 2,
        0,
        spriteSize / 2,
        spriteSize / 2,
        spriteSize / 2
      );
      grad.addColorStop(0, 'rgba(235, 240, 255, 0.28)');
      grad.addColorStop(0.2, 'rgba(220, 228, 245, 0.20)');
      grad.addColorStop(0.45, 'rgba(180, 195, 220, 0.10)');
      grad.addColorStop(0.7, 'rgba(120, 150, 190, 0.03)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      sCtx.fillStyle = grad;
      sCtx.beginPath();
      sCtx.arc(spriteSize / 2, spriteSize / 2, spriteSize / 2, 0, Math.PI * 2);
      sCtx.fill();
    }

    // Secondary slight crystal-blue tinted smoke sprite for visual depth
    const blueSpriteCanvas = document.createElement('canvas');
    blueSpriteCanvas.width = spriteSize;
    blueSpriteCanvas.height = spriteSize;
    const bCtx = blueSpriteCanvas.getContext('2d');

    if (bCtx) {
      const bGrad = bCtx.createRadialGradient(
        spriteSize / 2,
        spriteSize / 2,
        0,
        spriteSize / 2,
        spriteSize / 2,
        spriteSize / 2
      );
      bGrad.addColorStop(0, 'rgba(186, 230, 253, 0.22)');
      bGrad.addColorStop(0.3, 'rgba(125, 211, 252, 0.12)');
      bGrad.addColorStop(0.6, 'rgba(56, 189, 248, 0.04)');
      bGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      bCtx.fillStyle = bGrad;
      bCtx.beginPath();
      bCtx.arc(spriteSize / 2, spriteSize / 2, spriteSize / 2, 0, Math.PI * 2);
      bCtx.fill();
    }

    // Particle parameters
    const particleCount = Math.min(38, Math.max(22, Math.floor(width / 50)));
    const particles = [];

    class SmokeParticle {
      constructor(isInitial = false) {
        this.reset(isInitial);
      }

      reset(isInitial = false) {
        this.x = Math.random() * width;
        // If initial load, distribute across entire screen height; otherwise start near bottom
        this.y = isInitial ? Math.random() * height : height + Math.random() * 120;
        this.baseSize = 140 + Math.random() * 180;
        this.scale = isInitial ? 0.8 + Math.random() * 0.6 : 0.6;
        this.growthRate = 0.003 + Math.random() * 0.004;

        this.vx = (Math.random() - 0.5) * 0.45;
        this.vy = -(0.35 + Math.random() * 0.55); // upward drifting speed
        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 0.004;

        this.maxLife = 500 + Math.random() * 400;
        this.life = isInitial ? Math.random() * this.maxLife : 0;
        this.maxOpacity = 0.45 + Math.random() * 0.35; // Clearly visible!
        this.isBlue = Math.random() > 0.65;
        this.wobbleSpeed = 0.001 + Math.random() * 0.002;
        this.wobbleAmp = 20 + Math.random() * 30;
      }

      update(time) {
        this.life += 1;
        if (this.life >= this.maxLife || this.y < -this.baseSize * this.scale) {
          this.reset(false);
          return;
        }

        // Horizontal sinusoidal undulating curl
        const wobble = Math.sin(time * this.wobbleSpeed + this.x * 0.01) * 0.4;
        this.x += this.vx + wobble;
        this.y += this.vy;
        this.rotation += this.rotSpeed;
        this.scale += this.growthRate;

        // Smooth fade-in, sustain, and fade-out envelope
        const progress = this.life / this.maxLife;
        if (progress < 0.2) {
          this.opacity = (progress / 0.2) * this.maxOpacity;
        } else if (progress > 0.65) {
          this.opacity = (1 - (progress - 0.65) / 0.35) * this.maxOpacity;
        } else {
          this.opacity = this.maxOpacity;
        }
      }

      draw(context) {
        if (this.opacity <= 0.01) return;
        const currentSize = this.baseSize * this.scale;
        context.save();
        context.translate(this.x, this.y);
        context.rotate(this.rotation);
        context.globalAlpha = Math.max(0, Math.min(1, this.opacity));
        const sprite = this.isBlue ? blueSpriteCanvas : spriteCanvas;
        context.drawImage(
          sprite,
          -currentSize / 2,
          -currentSize / 2,
          currentSize,
          currentSize
        );
        context.restore();
      }
    }

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      particles.push(new SmokeParticle(true));
    }

    const motionQuery =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let prefersReducedMotion = motionQuery ? motionQuery.matches : false;

    let isVisible = true;
    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      if (prefersReducedMotion && isVisible) {
        ctx.clearRect(0, 0, width, height);
        for (let i = 0; i < particles.length; i++) {
          particles[i].draw(ctx);
        }
      }
    };
    window.addEventListener('resize', handleResize);

    const render = (time) => {
      if (isVisible) {
        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < particles.length; i++) {
          if (!prefersReducedMotion) {
            particles[i].update(time);
          }
          particles[i].draw(ctx);
        }
      }
      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    const handleMotionChange = (e) => {
      prefersReducedMotion = Boolean(e.matches);
      cancelAnimationFrame(animationFrameId);
      if (prefersReducedMotion) {
        if (isVisible) {
          ctx.clearRect(0, 0, width, height);
          for (let i = 0; i < particles.length; i++) {
            particles[i].draw(ctx);
          }
        }
      } else {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    if (motionQuery?.addEventListener) {
      motionQuery.addEventListener('change', handleMotionChange);
    } else if (motionQuery?.addListener) {
      motionQuery.addListener(handleMotionChange);
    }

    if (prefersReducedMotion) {
      for (let i = 0; i < particles.length; i++) {
        particles[i].draw(ctx);
      }
    } else {
      animationFrameId = requestAnimationFrame(render);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (motionQuery?.removeEventListener) {
        motionQuery.removeEventListener('change', handleMotionChange);
      } else if (motionQuery?.removeListener) {
        motionQuery.removeListener(handleMotionChange);
      }
    };
  }, []);

  return (
    <div className="smoke-background-container" aria-hidden="true">
      {/* HTML5 Dynamic 60fps Volumetric Smoke Canvas */}
      <canvas ref={canvasRef} className="smoke-canvas" />

      {/* Layered Ethereal Atmospheric Mist Billows */}
      <div className="smoke-mist-layer" />
      <div className="smoke-cloud smoke-cloud-1" />
      <div className="smoke-cloud smoke-cloud-2" />
      <div className="smoke-cloud smoke-cloud-3" />
      <div className="smoke-cloud smoke-cloud-4" />
      <div className="smoke-wisp smoke-wisp-1" />
      <div className="smoke-wisp smoke-wisp-2" />
    </div>
  );
};

export default SmokeBackground;
