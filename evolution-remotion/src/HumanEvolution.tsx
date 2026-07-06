import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {Audio} from '@remotion/media';

const chapters = [
  {
    image: '01_early_hominins.png',
    title: 'Early Hominins',
    era: '7-4 million years ago',
    caption: 'Upright walking begins to reshape life on open woodland edges.',
    accent: '#c77f4f',
  },
  {
    image: '02_australopithecus.png',
    title: 'Australopithecus',
    era: '4-2 million years ago',
    caption: 'Hands, feet, and balance adapt to both trees and ground.',
    accent: '#c77f4f',
  },
  {
    image: '03_homo_habilis.png',
    title: 'Homo habilis',
    era: '2.4-1.5 million years ago',
    caption: 'Stone tools extend memory, skill, and shared survival.',
    accent: '#b78f5b',
  },
  {
    image: '04_homo_erectus.png',
    title: 'Homo erectus',
    era: '1.9 million-110,000 years ago',
    caption: 'Long-distance walking and fire open new landscapes.',
    accent: '#da763d',
  },
  {
    image: '05_early_sapiens.png',
    title: 'Early Homo sapiens',
    era: '300,000-40,000 years ago',
    caption: 'Symbol, language, and craft deepen social worlds.',
    accent: '#7f9987',
  },
  {
    image: '06_modern_humans.png',
    title: 'Modern Humans',
    era: 'Today',
    caption: 'Culture, science, and care become part of our evolutionary story.',
    accent: '#5b8b97',
  },
];

const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};

const Chapter: React.FC<{chapter: (typeof chapters)[number]; index: number}> = ({chapter, index}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const start = index * 6 * fps;
  const local = frame - start;
  const fadeIn = interpolate(frame, [start - 0.7 * fps, start + 0.4 * fps], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.37, 0, 0.63, 1),
  });
  const fadeOut = index === chapters.length - 1
    ? interpolate(frame, [34.5 * fps, 36 * fps], [1, 0], clamp)
    : interpolate(frame, [(index + 1) * 6 * fps - 0.7 * fps, (index + 1) * 6 * fps + 0.35 * fps], [1, 0], clamp);
  const opacity = Math.min(fadeIn, fadeOut);
  const imageScale = interpolate(local, [0, 6 * fps], [1.08, 1.01], clamp);
  const imageX = interpolate(local, [0, 6 * fps], [index % 2 === 0 ? 28 : -28, 0], clamp);
  const textIn = (offset: number) =>
    interpolate(local, [offset * fps, (offset + 0.75) * fps], [0, 1], {
      ...clamp,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundColor: '#2f2a24',
        overflow: 'hidden',
        filter: `blur(${interpolate(opacity, [0, 1], [18, 0], clamp)}px)`,
      }}
    >
      <Img
        src={staticFile(chapter.image)}
        style={{
          position: 'absolute',
          inset: -24,
          width: 1968,
          height: 1128,
          objectFit: 'cover',
          transform: `translateX(${imageX}px) scale(${imageScale})`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 72% 24%, rgba(240,222,192,0.22), rgba(240,222,192,0) 30%), linear-gradient(90deg, rgba(47,42,36,0.72), rgba(47,42,36,0.08) 56%, rgba(47,42,36,0.25))',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: '110px 150px 138px',
          gap: 20,
          maxWidth: 1120,
        }}
      >
        <p
          style={{
            margin: 0,
            color: chapter.accent,
            fontFamily: 'Arial, sans-serif',
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            opacity: textIn(0.3),
            transform: `translateY(${interpolate(textIn(0.3), [0, 1], [34, 0])}px)`,
          }}
        >
          {chapter.era}
        </p>
        <h1
          style={{
            margin: 0,
            color: '#f3dfbe',
            fontFamily: 'Georgia, serif',
            fontSize: 106,
            lineHeight: 0.98,
            fontWeight: 900,
            maxWidth: 1000,
            opacity: textIn(0.48),
            transform: `translateY(${interpolate(textIn(0.48), [0, 1], [58, 0])}px) scale(${interpolate(textIn(0.48), [0, 1], [0.98, 1])})`,
          }}
        >
          {chapter.title}
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: 820,
            color: '#f4e8d4',
            fontFamily: 'Arial, sans-serif',
            fontSize: 36,
            lineHeight: 1.25,
            fontWeight: 300,
            opacity: textIn(0.9),
            transform: `translateY(${interpolate(textIn(0.9), [0, 1], [30, 0])}px)`,
          }}
        >
          {chapter.caption}
        </p>
      </div>
    </AbsoluteFill>
  );
};

export const HumanEvolution: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{backgroundColor: '#2f2a24'}}>
      <Audio
        src={staticFile('soothing-evolution.wav')}
        volume={(audioFrame) => {
          const intro = interpolate(audioFrame, [0, 3 * fps], [0, 0.55], clamp);
          const outro = interpolate(audioFrame, [33 * fps, 36 * fps], [0.55, 0], clamp);
          return Math.min(intro, outro);
        }}
      />
      {chapters.map((chapter, index) => (
        <Chapter key={chapter.image} chapter={chapter} index={index} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: 150,
          right: 150,
          bottom: 74,
          zIndex: 10,
          display: 'grid',
          gridTemplateColumns: `repeat(${chapters.length}, 1fr)`,
          gap: 18,
        }}
      >
        {chapters.map((chapter, index) => {
          const active = interpolate(frame, [index * 6 * fps, index * 6 * fps + 0.45 * fps], [0, 1], clamp);
          return (
            <span
              key={chapter.image}
              style={{
                height: 5,
                borderRadius: 999,
                backgroundColor: active > 0.5 ? chapter.accent : 'rgba(240,222,192,0.3)',
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
