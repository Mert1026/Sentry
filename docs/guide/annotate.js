// Places the numbered pins, rings and arrows on each screenshot.
//
//   <figure class="shot">
//     <div class="frame" data-src="img/run.jpg" data-crop="0,40,60,55">   (optional crop: x,y,w,h in % of the image)
//       <i class="pin" data-x="52" data-y="31" data-dx="-14" data-dy="-10">1</i>
//       <i class="ring" data-box="40,20,30,8"></i>                         (x,y,w,h in % of the image)
//     </div>
//   </figure>
//
// data-x / data-y: the point the arrow points at, in % of the full image.
// data-dx / data-dy: where the numbered badge sits, in mm from that point (0,0 puts it on the point).
// Everything is set in % of the picture and in mm, never in screen pixels, so it stays in place
// when the page is laid out again for printing.
(() => {
  const PAD = 1.4; // mm, the frame's padding (guide.css)
  const at = (percent) => `calc(${PAD}mm + (100% - ${2 * PAD}mm) * ${percent / 100})`;

  for (const frame of document.querySelectorAll('.shot .frame')) {
    const crop = (frame.dataset.crop ?? '0,0,100,100').split(',').map(Number);
    const [cx, cy, cw, ch] = crop;
    const local = (x, y) => [((x - cx) / cw) * 100, ((y - cy) / ch) * 100];

    const img = document.createElement('img');
    img.src = frame.dataset.src;
    img.alt = frame.dataset.alt ?? '';
    if (frame.dataset.crop) {
      frame.classList.add('crop');
      const viewport = document.createElement('div');
      viewport.className = 'viewport';
      img.style.width = (100 / cw) * 100 + '%';
      img.style.left = (-cx / cw) * 100 + '%';
      const ratio = Number(frame.dataset.ratio ?? 0.625); // image height / width
      viewport.style.aspectRatio = String(cw / (ch * ratio));
      img.style.marginTop = -((cy / 100) * ratio * (100 / cw)) * 100 + '%';
      viewport.append(img);
      frame.prepend(viewport);
    } else {
      frame.prepend(img);
    }

    for (const ring of frame.querySelectorAll('.ring')) {
      const [x, y, bw, bh] = ring.dataset.box.split(',').map(Number);
      const [lx, ly] = local(x, y);
      ring.style.left = at(lx);
      // A % in top/height resolves against the frame's height, so the same formula works on both axes.
      ring.style.top = at(ly);
      ring.style.width = `calc((100% - ${2 * PAD}mm) * ${bw / cw})`;
      ring.style.height = `calc((100% - ${2 * PAD}mm) * ${bh / ch})`;
    }

    for (const pin of frame.querySelectorAll('.pin')) {
      const [lx, ly] = local(Number(pin.dataset.x), Number(pin.dataset.y));
      const dx = Number(pin.dataset.dx ?? 0);
      const dy = Number(pin.dataset.dy ?? 0);
      pin.style.left = `calc(${at(lx).slice(5, -1)} + ${dx}mm)`;
      pin.style.top = `calc(${at(ly).slice(5, -1)} + ${dy}mm)`;
      const length = Math.hypot(dx, dy);
      if (length < 4) continue;
      // A line from the target towards the badge, stopping at the badge's edge; the head is at the target.
      const arrow = document.createElement('b');
      arrow.className = 'arrow';
      arrow.style.left = at(lx);
      arrow.style.top = at(ly);
      arrow.style.width = length - 3.4 + 'mm';
      arrow.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
      frame.append(arrow);
    }
  }
})();
