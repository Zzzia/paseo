import { Text, View, type StyleProp, type TextStyle } from "react-native";

export interface MathFormulaProps {
  expression: string;
  source: string;
  displayMode: boolean;
  textStyle?: StyleProp<TextStyle>;
}

export function MathFormula({ source, displayMode, textStyle }: MathFormulaProps) {
  if (displayMode) {
    return (
      <View>
        <Text selectable style={textStyle}>
          {source}
        </Text>
      </View>
    );
  }

  return (
    <Text selectable style={textStyle}>
      {source}
    </Text>
  );
}
