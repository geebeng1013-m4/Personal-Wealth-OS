import React from 'react';
import {Composition} from 'remotion';
import {HumanEvolution} from './HumanEvolution';

export const Root: React.FC = () => {
  return (
    <Composition
      id="HumanEvolution"
      component={HumanEvolution}
      durationInFrames={1080}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
