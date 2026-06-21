import {gql} from '@apollo/client';

export const COMPUTE_SIZE = gql`
    mutation JcrStatsComputeSize($path: String, $deleteTemporaryFile: Boolean) {
        jcrStats {
            computeSize(path: $path, deleteTemporaryFile: $deleteTemporaryFile) {
                path
                totalSize
                nodeCount
                flamegraphPath
            }
        }
    }
`;

export const GET_REPORTS = gql`
    query JcrStatsReports {
        jcrStats {
            reports {
                path
                name
            }
        }
    }
`;

export const GET_SIZE = gql`
    query JcrStatsSize($path: String) {
        jcrStats {
            size(path: $path)
            nodeCount(path: $path)
        }
    }
`;
