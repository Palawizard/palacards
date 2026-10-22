import { redirect } from "next/navigation";

/** L'article du jour est remplacé par « Plus ou moins vu » : les anciens liens y mènent. */
export default function ArticleRedirect() {
  redirect("/plus-ou-moins");
}
