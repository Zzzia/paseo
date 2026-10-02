import { StyleSheet } from "react-native-unistyles";

export const styles = StyleSheet.create((theme) => ({
  workspaceRowContainer: {
    position: "relative",
  },
  workspaceRow: {
    minHeight: 36,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  workspaceRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  workspaceRowDragging: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.md,
  },
  sidebarRowSelected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
  },
  workspaceCreatingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
}));
