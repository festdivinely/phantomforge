import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { colors, ui } from '../lib/theme';

export interface Bar {
  label: string;
  value: number;
}

/**
 * A plain bar chart: one bar per day, the latest on the right. Tap a bar to
 * read its exact value.
 */
export function BarChart({ bars, color = colors.accent, height = 140 }: { bars: Bar[]; color?: string; height?: number }) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const top = 14;
  const bottom = 18;
  const plot = height - top - bottom;
  const slot = bars.length ? width / bars.length : 0;
  const barWidth = Math.max(2, slot * 0.6);
  const shown = selected !== null ? bars[selected] : undefined;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text style={[ui.muted, { minHeight: 18 }]}>
        {shown ? `${shown.label}: ${shown.value}` : `Highest day: ${Math.max(0, ...bars.map((b) => b.value))}`}
      </Text>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Line x1={0} x2={width} y1={top + plot} y2={top + plot} stroke={colors.cardBorder} />
          {bars.map((bar, i) => {
            const h = (bar.value / max) * plot;
            const x = i * slot + (slot - barWidth) / 2;
            return (
              <Rect
                key={bar.label}
                x={x}
                y={top + plot - Math.max(h, bar.value > 0 ? 2 : 0)}
                width={barWidth}
                height={Math.max(h, bar.value > 0 ? 2 : 0)}
                rx={2}
                fill={selected === i ? colors.text : color}
                onPress={() => setSelected(selected === i ? null : i)}
              />
            );
          })}
          {bars.map((bar, i) =>
            i % Math.ceil(bars.length / 5) === 0 || i === bars.length - 1 ? (
              <SvgText
                key={`l-${bar.label}`}
                x={i * slot + slot / 2}
                y={height - 4}
                fill={colors.muted}
                fontSize={10}
                textAnchor="middle"
              >
                {bar.label.slice(5)}
              </SvgText>
            ) : null,
          )}
        </Svg>
      )}
    </View>
  );
}
