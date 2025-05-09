document.addEventListener("DOMContentLoaded", () => {
    // Show success messages
    const urlParams = new URLSearchParams(window.location.search)
    const mensaje = urlParams.get("mensaje")
  
    if (mensaje === "guardado") {
      showToast("Imagen guardada en la colección")
    }
  
    // Enable tooltips
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
    tooltipTriggerList.map((tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl))
  
    // Enable popovers
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'))
    popoverTriggerList.map((popoverTriggerEl) => new bootstrap.Popover(popoverTriggerEl))
  
    // Function to show toast notifications
    function showToast(message) {
      // Create toast container if it doesn't exist
      let toastContainer = document.getElementById("toast-container")
      if (!toastContainer) {
        toastContainer = document.createElement("div")
        toastContainer.id = "toast-container"
        toastContainer.className = "position-fixed bottom-0 end-0 p-3"
        toastContainer.style.zIndex = "11"
        document.body.appendChild(toastContainer)
      }
  
      // Create toast element
      const toastId = "toast-" + Date.now()
      const toastEl = document.createElement("div")
      toastEl.id = toastId
      toastEl.className = "toast"
      toastEl.setAttribute("role", "alert")
      toastEl.setAttribute("aria-live", "assertive")
      toastEl.setAttribute("aria-atomic", "true")
  
      toastEl.innerHTML = `
        <div class="toast-header">
          <strong class="me-auto">Imagina</strong>
          <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body">
          ${message}
        </div>
      `
  
      toastContainer.appendChild(toastEl)
  
      // Initialize and show toast
      const toast = new bootstrap.Toast(toastEl, {
        autohide: true,
        delay: 3000,
      })
      toast.show()
  
      // Remove toast after it's hidden
      toastEl.addEventListener("hidden.bs.toast", () => {
        toastEl.remove()
      })
    }
  
    // Add global function to window object
    window.showToast = showToast
  })
  