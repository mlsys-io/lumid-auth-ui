import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/index.css";
import DesignGallery from "./DesignGallery";

createRoot(document.getElementById("root")!).render(
	<MemoryRouter initialEntries={["/studio/library/marketplace"]}>
		<DesignGallery />
	</MemoryRouter>,
);
