// ModelToggle (40 section 13.9): "Ready" or "Not available (simulate)" when this Chrome has the model; otherwise both
// options are disabled and say why.
import { PLAYGROUND_COPY } from '@/copy/screens-main';
import { Segmented } from '@/components/Segmented/Segmented';
import { toggleOptions, type PlaygroundModel, type ToggleValue } from './playgroundModel';

export interface ModelToggleProps {
  model: PlaygroundModel;
  onSimulate(on: boolean): void;
}

export function ModelToggle({ model, onSimulate }: ModelToggleProps) {
  const { options, value } = toggleOptions(model);
  return (
    <Segmented<ToggleValue>
      label={PLAYGROUND_COPY.toggleLabel}
      options={options}
      value={value}
      onChange={(v) => onSimulate(v === 'off')}
      toneFor={(v) => (v === 'off' ? 'warn' : 'default')}
    />
  );
}
