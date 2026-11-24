(function () {
  let loadedUserId = null;

  function sellerState() {
    return window.NOVAAISellerState?.() || {};
  }

  window.loadSellerWhatsAppContact = function () {
    const state = sellerState();
    const field = document.getElementById("sellerWhatsAppNumber");
    const status = document.getElementById("sellerWhatsAppStatus");

    if (!field || !status) return;

    if (!state.user || !state.storeData) {
      field.value = "";
      loadedUserId = null;
      status.textContent = "Sign in to manage your WhatsApp contact.";
      return;
    }

    const digits = String(state.storeData.whatsapp_phone || "").replace(/\D/g, "");
    field.value = digits ? "+" + digits : "";
    loadedUserId = state.user.id;
    status.textContent = digits
      ? "Your saved WhatsApp number is loaded."
      : "Add the WhatsApp number customers should use.";
  };

  document.getElementById("sellerWhatsAppSave")
    ?.addEventListener("click", async function () {
      const field = document.getElementById("sellerWhatsAppNumber");
      const status = document.getElementById("sellerWhatsAppStatus");
      const state = sellerState();
      const targetUser = state.user;

      if (!targetUser || !state.storeData) {
        status.textContent = "Sign in and wait for your store details to load.";
        return;
      }

      if (loadedUserId !== targetUser.id) {
        status.textContent = "Store details are still loading. Try again.";
        return;
      }

      let digits = field.value.trim().replace(/\D/g, "");
      if (digits.startsWith("0")) digits = "27" + digits.slice(1);

      if (digits && (!digits.startsWith("27") || digits.length !== 11)) {
        status.textContent =
          "Enter a valid South African number, e.g. 082 123 4567.";
        return;
      }

      const button = document.getElementById("sellerWhatsAppSave");
      button.disabled = true;
      status.textContent = "Saving WhatsApp number…";

      try {
        const { data, error } = await sb
          .from("seller_stores")
          .update({ whatsapp_phone: digits || null })
          .eq("user_id", targetUser.id)
          .select("id,whatsapp_phone")
          .maybeSingle();

        if (user !== targetUser) return;

        if (error) {
          console.error("[NOVAAI WhatsApp contact]", error);
          status.textContent = "Could not save: " + error.message;
          return;
        }

        if (!data) {
          status.textContent = "No seller store was updated. Please refresh.";
          return;
        }

        state.storeData.whatsapp_phone = data.whatsapp_phone || "";
        field.value = data.whatsapp_phone
          ? "+" + String(data.whatsapp_phone).replace(/\D/g, "")
          : "";
        status.textContent = "WhatsApp number saved successfully.";
      } catch (error) {
        console.error("[NOVAAI WhatsApp contact]", error);
        status.textContent = "Unexpected error. Please try again.";
      } finally {
        button.disabled = false;
      }
    });
})();
