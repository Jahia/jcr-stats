package org.jahia.community.jcrstats;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * F34: guards the shipped role/permission definitions imported at module install time.
 *
 * <p>The Cypress permission specs grant {@code jcrStatsAdmin} directly, so the bundling of that
 * permission into the {@code jcr-stats-administrator} role is otherwise untested. An accidental
 * rename of the permission (or loss of {@code j:privilegedAccess}) would silently break the shipped
 * role without failing any other test. These files are imported content (under {@code src/main/import},
 * not on the classpath), so they are read from the module base directory — surefire runs with the
 * module root as the working directory.</p>
 */
public class RolesPermissionsXmlTest {

    private static Document parse(String relativePath) throws Exception {
        final DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        // Parse literal qualified attribute names (j:permissionNames) rather than resolving namespaces.
        factory.setNamespaceAware(false);
        final DocumentBuilder builder = factory.newDocumentBuilder();
        final File file = new File(relativePath);
        assertThat(file).as("shipped import file %s must exist", relativePath).exists();
        return builder.parse(file);
    }

    @Test
    public void role_bundlesAdministrationAccessAndJcrStatsAdmin_withPrivilegedAccess() throws Exception {
        final Document doc = parse("src/main/import/roles.xml");
        final NodeList roles = doc.getElementsByTagName("jcr-stats-administrator");
        assertThat(roles.getLength()).as("roles.xml must define the jcr-stats-administrator role").isEqualTo(1);

        final Element role = (Element) roles.item(0);
        assertThat(role.getAttribute("jcr:primaryType")).isEqualTo("jnt:role");
        // Both permissions must be bundled (space-separated list on j:permissionNames).
        assertThat(role.getAttribute("j:permissionNames").split("\\s+"))
                .containsExactlyInAnyOrder("administrationAccess", "jcrStatsAdmin");
        // Privileged access is what lets the role read across sites for the stats traversal.
        assertThat(role.getAttribute("j:privilegedAccess")).isEqualTo("true");
    }

    @Test
    public void permission_jcrStatsAdmin_isDefinedUnderAdmin() throws Exception {
        final Document doc = parse("src/main/import/permissions.xml");
        final NodeList admin = doc.getElementsByTagName("admin");
        assertThat(admin.getLength()).as("permissions.xml must define the admin permission group").isEqualTo(1);

        final NodeList jcrStatsAdmin = ((Element) admin.item(0)).getElementsByTagName("jcrStatsAdmin");
        assertThat(jcrStatsAdmin.getLength())
                .as("the jcrStatsAdmin permission must be defined under admin (the name the role and "
                        + "@GraphQLRequiresPermission both reference)")
                .isEqualTo(1);
        assertThat(((Element) jcrStatsAdmin.item(0)).getAttribute("jcr:primaryType")).isEqualTo("jnt:permission");
    }
}
