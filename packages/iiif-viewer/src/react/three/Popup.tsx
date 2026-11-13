// The label of a note in the 3D view. `action` is a button under it (e.g. move the view to the note).
const Popup = ({ content, action }: { content: string; action?: { label: string; onClick: () => void } }) => {
  return (
    <div className="absolute left-8 top-0 z-10">
      <div className="w-max max-w-xs bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow-lg">
        <div className="text-sm text-gray-800 dark:text-gray-100">{content}</div>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1 text-xs text-blue-700 dark:text-blue-300 underline cursor-pointer"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
};

export default Popup;
