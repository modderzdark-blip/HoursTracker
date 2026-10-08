// INPUT: touch-first pointer handling on the board (tap-tap and swipe), plus optional keyboard support.
// Pointer coordinates are converted to cells in CSS pixels, so DPR and canvas scaling never affect hit-testing.
(function attachInput(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const CONFIG = SC.CONFIG;

  /**
   * handlers: { canInteract(), getSelected(), select(cell), requestSwap(from, to), activity() }
   */
  function createBoardInput(surface, renderer, handlers) {
    let gesture = null; // { pointer_id, start_x, start_y, cell, swapped }

    function neighborInDirection(cell, delta_x, delta_y) {
      const board = renderer.board;
      if (!board) return -1;
      const row = Math.floor(cell / board.cols);
      const col = cell % board.cols;
      const horizontal = Math.abs(delta_x) >= Math.abs(delta_y);
      const target_row = row + (horizontal ? 0 : Math.sign(delta_y));
      const target_col = col + (horizontal ? Math.sign(delta_x) : 0);
      if (target_row < 0 || target_col < 0 || target_row >= board.rows || target_col >= board.cols) return -1;
      const target = target_row * board.cols + target_col;
      return board.holes[target] ? -1 : target;
    }

    function areAdjacent(first, second) {
      const cols = renderer.board.cols;
      return Math.abs(Math.floor(first / cols) - Math.floor(second / cols)) + Math.abs((first % cols) - (second % cols)) === 1;
    }

    function resetGesture() {
      if (gesture && surface.hasPointerCapture && surface.hasPointerCapture(gesture.pointer_id)) {
        try {
          surface.releasePointerCapture(gesture.pointer_id);
        } catch (release_error) {
          // already released
        }
      }
      gesture = null;
      renderer.setDrag(-1, 0, 0);
    }

    function onPointerDown(event) {
      if (gesture || !handlers.canInteract()) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const cell = renderer.cellFromPoint(event.clientX, event.clientY);
      handlers.activity();
      if (cell < 0) return;
      event.preventDefault();
      gesture = { pointer_id: event.pointerId, start_x: event.clientX, start_y: event.clientY, cell, swapped: false };
      try {
        surface.setPointerCapture(event.pointerId);
      } catch (capture_error) {
        // capture is optional
      }
    }

    // Starts the swap once the finger has travelled far enough; returns true when the gesture became a swipe.
    function trySwipe(event) {
      const cell_size = renderer.layout.cell;
      const delta_x = event.clientX - gesture.start_x;
      const delta_y = event.clientY - gesture.start_y;
      if (Math.max(Math.abs(delta_x), Math.abs(delta_y)) <= CONFIG.SWIPE_THRESHOLD * cell_size) return false;
      const target = neighborInDirection(gesture.cell, delta_x, delta_y);
      gesture.swapped = true;
      renderer.setDrag(-1, 0, 0);
      if (target >= 0) {
        handlers.select(-1);
        handlers.requestSwap(gesture.cell, target);
      }
      return true;
    }

    function onPointerMove(event) {
      if (!gesture || event.pointerId !== gesture.pointer_id || gesture.swapped) return;
      if (!handlers.canInteract()) {
        resetGesture();
        return;
      }
      if (trySwipe(event)) return;
      // The candy follows the finger along the dominant axis, clamped to one cell.
      const cell_size = renderer.layout.cell;
      const delta_x = event.clientX - gesture.start_x;
      const delta_y = event.clientY - gesture.start_y;
      const horizontal = Math.abs(delta_x) >= Math.abs(delta_y);
      const clamp = (value) => Math.max(-cell_size, Math.min(cell_size, value));
      renderer.setDrag(gesture.cell, horizontal ? clamp(delta_x) : 0, horizontal ? 0 : clamp(delta_y));
    }

    function onPointerUp(event) {
      if (!gesture || event.pointerId !== gesture.pointer_id) return;
      // Fast flicks can arrive with few or coalesced move events, so the release point also counts as a swipe.
      if (!gesture.swapped && handlers.canInteract() && trySwipe(event)) {
        resetGesture();
        return;
      }
      const finished = gesture;
      resetGesture();
      if (finished.swapped || !handlers.canInteract()) return;
      const cell = finished.cell;
      const selected = handlers.getSelected();
      if (selected < 0) handlers.select(cell);
      else if (selected === cell) handlers.select(-1);
      else if (areAdjacent(selected, cell)) {
        handlers.select(-1);
        handlers.requestSwap(selected, cell);
      } else handlers.select(cell);
    }

    function onPointerCancel(event) {
      if (gesture && event.pointerId === gesture.pointer_id) resetGesture();
    }

    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerUp);
    surface.addEventListener('pointercancel', onPointerCancel);
    surface.addEventListener('lostpointercapture', onPointerCancel);
    surface.addEventListener('contextmenu', (event) => event.preventDefault());

    return {
      cancel: resetGesture,
      destroy() {
        resetGesture();
        surface.removeEventListener('pointerdown', onPointerDown);
        surface.removeEventListener('pointermove', onPointerMove);
        surface.removeEventListener('pointerup', onPointerUp);
        surface.removeEventListener('pointercancel', onPointerCancel);
        surface.removeEventListener('lostpointercapture', onPointerCancel);
      },
    };
  }

  SC.INPUT = { createBoardInput };
})(typeof window !== 'undefined' ? window : globalThis);
